import { describe, expect, it } from "vitest";
import {
  bindingFromEvent,
  blankGamePreset,
  editGameOption,
  parseGameOptions,
  supportedGameOptions,
  usesGraphicsPresets,
} from "../src/lib/game-settings";

describe("Minecraft settings profile editing", () => {
  it("preserves unknown options, colon values and Windows newlines while replacing duplicate keys", () => {
    const raw = "\uFEFFversion:3955\r\nfov:0\r\nunknown:a:b:c\r\nfov:0.25\r\n";
    const result = editGameOption(raw, "fov", "0.5");
    expect(parseGameOptions(result)).toEqual({
      version: "3955",
      unknown: "a:b:c",
      fov: "0.5",
    });
    expect(result.match(/fov:/g)).toHaveLength(1);
    expect(result).toContain("\r\n");
  });
  it("does not offer modern-only fields to legacy versions or invent unknown snapshot fields", () => {
    const p = blankGamePreset("Legacy");
    p.sourceVersion = "1.12.2";
    p.options = "mouseSensitivity:0.4\n";
    expect(supportedGameOptions(p, "mouse").map((o) => o.key)).not.toContain(
      "rawMouseInput",
    );
    expect(supportedGameOptions(p, "graphics").map((o) => o.key)).toContain(
      "fancyGraphics",
    );
    expect(supportedGameOptions(p, "graphics").map((o) => o.key)).not.toContain(
      "graphicsMode",
    );
    p.sourceVersion = "26w45a";
    expect(supportedGameOptions(p, "mouse").map((o) => o.key)).toEqual([
      "mouseSensitivity",
    ]);
  });
  it("handles the new graphics preset boundary and creates independently editable copies", () => {
    expect(usesGraphicsPresets("1.21.10")).toBe(false);
    expect(usesGraphicsPresets("1.21.11")).toBe(true);
    expect(usesGraphicsPresets("26.3")).toBe(true);
    const first = blankGamePreset("One"),
      second = blankGamePreset("Two");
    expect(first.id).not.toBe(second.id);
    first.categories.pop();
    expect(second.categories).toHaveLength(6);
  });
  it("captures physical keyboard codes independently of the keyboard language", () => {
    expect(bindingFromEvent({ code: "KeyW", key: "ц" } as KeyboardEvent)).toBe(
      "key.keyboard.w",
    );
    expect(bindingFromEvent({ code: "Numpad3" } as KeyboardEvent)).toBe(
      "key.keyboard.keypad.3",
    );
    expect(bindingFromEvent({ code: "ShiftRight" } as KeyboardEvent)).toBe(
      "key.keyboard.right.shift",
    );
    expect(bindingFromEvent({ code: "Unidentified" } as KeyboardEvent)).toBe(
      null,
    );
  });
});
