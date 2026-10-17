import { describe, expect, it } from "vitest";
import { formatHostingPath, hostingMotdText } from "../src/lib/hosting";

describe("hosting presentation", () => {
  it("hides Windows API prefixes without changing ordinary or Unix paths", () => {
    expect(
      formatHostingPath("\\\\?\\X:\\Work\\My Server", "runtime/network"),
    ).toBe("X:\\Work\\My Server\\runtime\\network");
    expect(formatHostingPath("\\\\?\\UNC\\host\\share", "lobby")).toBe(
      "\\\\host\\share\\lobby",
    );
    expect(formatHostingPath("X:/Servers/Friends", ".")).toBe(
      "X:\\Servers\\Friends",
    );
    expect(formatHostingPath("/home/player/servers", "lobby")).toBe(
      "/home/player/servers/lobby",
    );
  });
  it("shows readable MOTD text without interpreting HTML or Minecraft markup", () => {
    expect(
      hostingMotdText(
        "<gradient:#ff3b30:#ff8c1a>Friends</gradient> <#ffb36b>Survival</#ffb36b>",
      ),
    ).toBe("Friends Survival");
    expect(hostingMotdText("§aHello &lworld\\nNext")).toBe("Hello world\nNext");
  });
});
