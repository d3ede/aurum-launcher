package app.aurum.social;

import java.io.*;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/** Uses the game's native LAN entry. No transformers, token changes or network listeners. */
public final class LanJoinAgent {
    private static final AtomicBoolean queued = new AtomicBoolean();
    private static volatile boolean finished;
    private static volatile boolean connecting;
    private static Properties config;
    private static Path status;
    private static Object resolver;
    private static Method mapClass;

    public static void premain(String configuration, final Instrumentation instrumentation) {
        try {
            Path path = Paths.get(configuration);
            if (Files.size(path) > 16384) throw new IOException("Configuration exceeds limit");
            config = new Properties();
            try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) { config.load(reader); }
            String host = config.getProperty("host", "");
            if (!(host.equals("127.0.0.1") || host.equals("::1")) || !InetAddress.getByName(host).isLoopbackAddress())
                throw new IOException("Only the local broker bridge is allowed");
            int port = Integer.parseInt(config.getProperty("port", "0"));
            if (port < 1 || port > 65535) throw new IOException("Invalid local port");
            status = Paths.get(config.getProperty("status"));
            report("waiting");
            Thread thread = new Thread(new Runnable() { public void run() { watch(instrumentation); } }, "Aurum LAN join");
            thread.setDaemon(true);
            thread.start();
        } catch (Exception error) { report("unsupported"); }
    }

    private static void watch(Instrumentation instrumentation) {
        long deadline = System.nanoTime() + 600000000000L;
        while (!finished && System.nanoTime() < deadline) {
            try {
                Class<?> minecraft = null;
                Class<?>[] loaded = instrumentation.getAllLoadedClasses();
                if (resolver == null) findFabricResolver(loaded);
                Set<String> names = names("minecraft");
                for (Class<?> candidate : loaded) if (names.contains(candidate.getName())) { minecraft = candidate; break; }
                if (minecraft != null) {
                    final Object client = singleton(minecraft);
                    if (client instanceof Executor && queued.compareAndSet(false, true)) {
                        ((Executor) client).execute(new Runnable() { public void run() {
                            try { tick(client); } catch (Throwable error) { finished = true; report("unsupported"); }
                            finally { queued.set(false); }
                        }});
                    }
                }
                Thread.sleep(400);
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
              catch (ReflectiveOperationException | LinkageError ignored) { /* The loader may still be initializing. */ }
        }
        if (!finished) report("timeout");
    }

    private static void findFabricResolver(Class<?>[] loaded) {
        for (Class<?> type : loaded) if (type.getName().equals("net.fabricmc.loader.api.FabricLoader")) {
            try {
                Object loader = type.getMethod("getInstance").invoke(null);
                Object mappings = type.getMethod("getMappingResolver").invoke(loader);
                Class<?> api = Class.forName("net.fabricmc.loader.api.MappingResolver", false, type.getClassLoader());
                mapClass = api.getMethod("mapClassName", String.class, String.class);
                resolver = mappings;
            } catch (ReflectiveOperationException ignored) { }
            return;
        }
    }

    private static Set<String> names(String role) {
        Set<String> result = new LinkedHashSet<String>();
        for (String name : config.getProperty("class." + role, "").split(",")) {
            if (name.isEmpty()) continue;
            result.add(name);
            if (resolver != null) try { result.add((String) mapClass.invoke(resolver, "official", name)); }
            catch (ReflectiveOperationException ignored) { }
        }
        return result;
    }

    private static Class<?> type(String role, ClassLoader loader) throws ClassNotFoundException {
        for (String name : names(role)) try { return Class.forName(name, false, loader); }
        catch (ClassNotFoundException ignored) { }
        throw new ClassNotFoundException(role);
    }

    private static Object singleton(Class<?> minecraft) throws ReflectiveOperationException {
        Method found = null;
        for (Method method : minecraft.getMethods()) if (Modifier.isStatic(method.getModifiers()) &&
                method.getReturnType() == minecraft && method.getParameterTypes().length == 0) {
            if (found != null) throw new NoSuchMethodException("Ambiguous Minecraft singleton");
            found = method;
        }
        return found == null ? null : found.invoke(null);
    }

    private static Object value(Object holder, Class<?> valueType) throws ReflectiveOperationException {
        Method getter = null;
        for (Method method : holder.getClass().getMethods()) if (!Modifier.isStatic(method.getModifiers()) &&
                method.getReturnType() == valueType && method.getParameterTypes().length == 0) {
            if (getter != null) throw new NoSuchMethodException("Ambiguous client getter");
            getter = method;
        }
        if (getter != null) return getter.invoke(holder);
        Field found = null;
        for (Field field : holder.getClass().getDeclaredFields()) if (!Modifier.isStatic(field.getModifiers()) && field.getType() == valueType) {
            if (found != null) throw new NoSuchFieldException("Ambiguous client state");
            found = field;
        }
        if (found == null) throw new NoSuchFieldException(valueType.getName());
        if (!Modifier.isPublic(found.getModifiers())) found.setAccessible(true);
        return found.get(holder);
    }

    private static Object ui(Object client, Class<?> wanted, ClassLoader loader) throws ReflectiveOperationException {
        try { return value(client, wanted); }
        catch (NoSuchFieldException missing) { return value(value(client, type("gui", loader)), wanted); }
    }

    private static void tick(Object client) throws ReflectiveOperationException {
        ClassLoader loader = client.getClass().getClassLoader();
        Class<?> screen = type("screen", loader);
        Object current = ui(client, screen, loader);
        if (connecting) {
            if (value(client, type("level", loader)) != null && value(client, type("player", loader)) != null) { finished = true; report("joined"); }
            else if (current != null && (type("disconnect", loader).isInstance(current) || type("title", loader).isInstance(current))) {
                // The native disconnect/consent screen remains in control of the player.
                finished = true; report("game-screen");
            }
            return;
        }
        if (current == null || !type("title", loader).isInstance(current)) return;
        if (ui(client, type("overlay", loader), loader) != null) return;
        Class<?> serverType = type("server", loader);
        Object entry = lanEntry(serverType, config.getProperty("name", "Aurum"), address());
        Class<?> addressType = type("address", loader);
        Object parsed = parseAddress(addressType, address());
        Method connect = null;
        for (Method method : type("connect", loader).getDeclaredMethods()) {
            Class<?>[] args = method.getParameterTypes();
            if (!Modifier.isPublic(method.getModifiers()) || !Modifier.isStatic(method.getModifiers()) ||
                method.getReturnType() != Void.TYPE || args.length < 4 || args.length > 6 ||
                args[0] != screen || args[1] != client.getClass() || args[2] != addressType || args[3] != serverType) continue;
            if (args.length >= 5 && args[4] != Boolean.TYPE) continue;
            if (args.length == 6 && args[5].isPrimitive()) continue;
            if (connect != null) throw new NoSuchMethodException("Ambiguous LAN connector");
            connect = method;
        }
        if (connect == null) throw new NoSuchMethodException("LAN connector unavailable");
        Object[] args = new Object[connect.getParameterTypes().length];
        args[0] = current; args[1] = client; args[2] = parsed; args[3] = entry;
        if (args.length >= 5) args[4] = false;
        connect.invoke(null, args);
        connecting = true;
        report("connecting");
        System.out.println("[Aurum Social] Native LAN connection started");
    }

    /** Exposed only so integration probes can exercise the actual game constructor. */
    public static Object lanEntry(Class<?> serverType, String name, String address) throws ReflectiveOperationException {
        for (Constructor<?> constructor : serverType.getConstructors()) {
            Class<?>[] params = constructor.getParameterTypes();
            if (params.length != 3 || params[0] != String.class || params[1] != String.class) continue;
            if (params[2] == Boolean.TYPE) return constructor.newInstance(name, address, true);
            if (params[2].isEnum()) for (Object constant : params[2].getEnumConstants()) {
                if (((Enum<?>) constant).name().equals("LAN")) return constructor.newInstance(name, address, constant);
            }
        }
        throw new NoSuchMethodException("Native LAN server type unavailable");
    }

    public static Object parseAddress(Class<?> type, String address) throws ReflectiveOperationException {
        Method parser = null;
        for (Method method : type.getMethods()) if (Modifier.isStatic(method.getModifiers()) && method.getReturnType() == type &&
            Arrays.equals(method.getParameterTypes(), new Class<?>[] { String.class })) {
            if (parser != null) throw new NoSuchMethodException("Ambiguous address parser");
            parser = method;
        }
        if (parser == null) throw new NoSuchMethodException("Missing address parser");
        return parser.invoke(null, address);
    }

    private static String address() {
        String host = config.getProperty("host");
        return (host.contains(":") ? "[" + host + "]" : host) + ":" + config.getProperty("port");
    }
    private static void report(String state) {
        if (status == null) return;
        try { Files.write(status, (state + "\n").getBytes(StandardCharsets.UTF_8)); }
        catch (IOException ignored) { }
    }
}
