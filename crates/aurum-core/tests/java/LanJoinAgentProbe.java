import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.Executor;

/** JVM-level regression fixture: exercise the shipped agent and its real inbox. */
public class LanJoinAgentProbe {
    public static class Screen { }
    public static class Title extends Screen { }
    public static class Multiplayer extends Screen { }
    public static class Disconnected extends Screen { }
    public static class Overlay { }
    public static class Gui { }
    public static class Level { }
    public static class Player { }
    public static class Client implements Executor {
        private static final Client INSTANCE = new Client();
        public volatile Screen screen;
        public volatile Overlay overlay;
        public volatile Level level = new Level();
        public volatile Player player = new Player();
        public volatile int saves;
        public static Client getInstance() { return INSTANCE; }
        public void execute(Runnable runnable) { runnable.run(); }
        public void disconnect(Screen target, boolean transferring) {
            if (transferring) throw new AssertionError("Expected normal save/disconnect");
            saves++; level = null; player = null; screen = target;
        }
    }
    public static class Address {
        public final String address;
        private Address(String value) { address = value; }
        public static Address parse(String value) { return new Address(value); }
    }
    public static class Server {
        public final boolean lan;
        public Server(String name, String address, boolean isLan) { lan = isLan; }
    }
    public static class Connect {
        public static volatile int connections;
        public static void connect(Screen parent, Client client, Address address, Server server) {
            if (!server.lan || !address.address.startsWith("127.0.0.1:")) throw new AssertionError("Lost LAN semantics");
            if (client.level != null || client.player != null) throw new AssertionError("Previous world was not saved/closed");
            connections++; client.level = new Level(); client.player = new Player(); client.screen = null;
        }
    }
    private static void request(Path inbox, String host) throws Exception {
        Path temporary = inbox.resolveSibling("probe.part");
        Files.write(temporary, ("host=" + host + "\nport=30001\nname=Probe\n").getBytes(StandardCharsets.UTF_8));
        Files.move(temporary, inbox, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
    private static void await(Path status, String expected, int connections) throws Exception {
        long deadline = System.nanoTime() + 15000000000L;
        while (System.nanoTime() < deadline) {
            if (Files.exists(status) && new String(Files.readAllBytes(status), StandardCharsets.UTF_8).trim().equals(expected)
                    && Connect.connections == connections) return;
            Thread.sleep(50);
        }
        throw new AssertionError("Expected " + expected + ", connections=" + connections);
    }
    public static void main(String[] args) throws Exception {
        Path inbox = Paths.get(args[0]), status = Paths.get(args[1]);
        Path ready = Paths.get(args[2]);
        Client client = Client.getInstance();
        Thread.sleep(1200);
        if (Files.exists(ready)) throw new AssertionError("A running world is not the main menu");
        client.level = null; client.player = null;
        client.screen = new Title(); client.overlay = new Overlay();
        Thread.sleep(1600);
        if (Files.exists(ready)) throw new AssertionError("Title beneath loading overlay is not ready");
        client.screen = new Screen(); client.overlay = null;
        Thread.sleep(1200);
        if (Files.exists(ready)) throw new AssertionError("An arbitrary screen is not the main menu");
        client.screen = new Title();
        long menuDeadline = System.nanoTime() + 10000000000L;
        while (!Files.exists(ready) && System.nanoTime() < menuDeadline) Thread.sleep(50);
        if (!Files.exists(ready) || !new String(Files.readAllBytes(ready), StandardCharsets.UTF_8).equals("ready\n"))
            throw new AssertionError("An unobstructed main menu must signal readiness");
        Files.delete(ready);
        // Restore a world for the existing auto-join regression checks.
        client.level = new Level(); client.player = new Player(); client.screen = null;
        for (int count = 1; count <= 2; count++) {
            request(inbox, "127.0.0.1"); await(status, "joined", count);
            if (client.saves != count) throw new AssertionError("Native save/disconnect was skipped or repeated");
        }
        request(inbox, "192.0.2.1"); await(status, "unsupported", 2);
        request(inbox, "127.0.0.1"); await(status, "joined", 3);
        Thread.sleep(1200);
        if (Connect.connections != 3 || client.saves != 3 || Files.exists(inbox)) throw new AssertionError("A consumed request replayed");
        if (Files.exists(ready)) throw new AssertionError("Returning to the menu replayed the ready signal");
        System.out.println("PASS: readiness requires unobstructed main menu; no repeat; same JVM saved/left its world and joined three times; remote request rejected; no replay");
    }
}
