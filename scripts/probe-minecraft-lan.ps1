param(
  [Parameter(Mandatory=$true)][string]$ClientJar,
  [Parameter(Mandatory=$true)][string]$LibrariesRoot,
  [Parameter(Mandatory=$true)][string]$JavaPath
)
$ErrorActionPreference='Stop'
$ClientJar=[IO.Path]::GetFullPath($ClientJar)
$JavaPath=[IO.Path]::GetFullPath($JavaPath)
$projectRoot=Split-Path -Parent $PSScriptRoot
$probeRoot=Join-Path $projectRoot '.test-data/minecraft-lan-probe'
New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
$source=@'
import net.minecraft.client.server.LanServerDetection;
import net.minecraft.client.multiplayer.ServerData;
public class AurumLanProbe {
  public static void main(String[] args) throws Exception {
    net.minecraft.SharedConstants.tryDetectVersion();
    var list=new LanServerDetection.LanServerList();
    var detector=new LanServerDetection.LanServerDetector(list);
    detector.start();
    try {
      long until=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
      while(System.nanoTime()<until) {
        var servers=list.takeDirtyServers();
        if(servers!=null)for(var server:servers)if(server.getMotd().equals("Aurum: TCP fixture world")) {
          if(!server.getAddress().startsWith("127.0.0.1:"))throw new AssertionError("Bridge was not loopback-only");
          var entry=new ServerData(server.getMotd(),server.getAddress(),ServerData.Type.LAN);
          if(!entry.isLan())throw new AssertionError("Entry lost native LAN semantics");
          System.out.println("PASS: actual Minecraft LAN detector received the broker bridge; native ServerData.isLan() is true");
          return;
        }
        Thread.sleep(50);
      }
      throw new AssertionError("No broker LAN advertisement received");
    } finally {detector.interrupt();detector.join(5500);}
  }
}
'@
$sourcePath=Join-Path $probeRoot 'AurumLanProbe.java'
[IO.File]::WriteAllText($sourcePath,$source,[Text.UTF8Encoding]::new($false))
$classPath=(@($ClientJar,$probeRoot)+(Get-ChildItem -LiteralPath $LibrariesRoot -Filter '*.jar' -File -Recurse | ForEach-Object FullName)) -join ';'
$escapedClassPath=$classPath.Replace('\','\\').Replace('"','\"')
$compileArgs=Join-Path $probeRoot 'javac.args'
[IO.File]::WriteAllText($compileArgs,"-classpath `"$escapedClassPath`"`n`"$($sourcePath.Replace('\','\\'))`"`n",[Text.UTF8Encoding]::new($false))
$javac=Join-Path (Split-Path -Parent $JavaPath) 'javac.exe'
& $javac "@$compileArgs"
if($LASTEXITCODE){throw 'Minecraft LAN probe compilation failed'}
$runArgs=Join-Path $probeRoot 'java.args'
[IO.File]::WriteAllText($runArgs,"-classpath `"$escapedClassPath`"`nAurumLanProbe`n",[Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $probeRoot
try {
  & $JavaPath "@$runArgs"
  if($LASTEXITCODE){throw 'Minecraft LAN probe failed'}
} finally { Pop-Location }
