import { describe, expect, it } from "vitest";
import {
  buildShareableUrl,
  decodeUrlState,
  encodeUrlState,
  hiddenLayersOf,
  layersFromHidden,
} from "../src/lib/urlState";
import { LAYER_ORDER } from "../src/lib/palette";
import type { LayerId } from "../src/types";

const ALL_ON = LAYER_ORDER.reduce(
  (acc, id) => ({ ...acc, [id]: true }),
  {} as Record<LayerId, boolean>,
);

describe("encodeUrlState", () => {
  it("produces an empty query string for the all-defaults state", () => {
    expect(encodeUrlState({}).toString()).toBe("");
    expect(encodeUrlState({ filter: "all", view: "scene3d" }).toString()).toBe("");
  });

  it("includes only the fields that differ from their default", () => {
    const qs = encodeUrlState({ date: "2026-08-12" });
    expect(qs.get("d")).toBe("2026-08-12");
    expect(qs.has("p")).toBe(false);
    expect(qs.has("f")).toBe(false);
    expect(qs.has("v")).toBe(false);
    expect(qs.has("off")).toBe(false);
  });

  it("encodes a project id, a non-default filter and a non-default view", () => {
    const qs = encodeUrlState({ projectId: "demo-ps-malolos", filter: "flood", view: "schematic" });
    expect(qs.get("p")).toBe("demo-ps-malolos");
    expect(qs.get("f")).toBe("flood");
    expect(qs.get("v")).toBe("schematic");
  });

  it("joins hidden layers with a comma and omits an empty list", () => {
    expect(encodeUrlState({ hiddenLayers: [] }).has("off")).toBe(false);
    const qs = encodeUrlState({ hiddenLayers: ["waterways", "flood-barrier"] });
    expect(qs.get("off")).toBe("waterways,flood-barrier");
  });
});

describe("decodeUrlState", () => {
  it("returns an empty state for an empty query string", () => {
    expect(decodeUrlState("", LAYER_ORDER)).toEqual({});
    expect(decodeUrlState("?", LAYER_ORDER)).toEqual({});
  });

  it("round-trips a full state through encode and decode", () => {
    const original = {
      date: "2026-08-12",
      projectId: "demo-fg-paombong",
      filter: "reported" as const,
      view: "schematic" as const,
      hiddenLayers: ["pumping-station", "airport-vicinity"] as LayerId[],
    };
    const decoded = decodeUrlState(encodeUrlState(original).toString(), LAYER_ORDER);
    expect(decoded).toEqual(original);
  });

  it("drops a malformed date instead of accepting it", () => {
    expect(decodeUrlState("d=12-Aug-2026", LAYER_ORDER).date).toBeUndefined();
    expect(decodeUrlState("d=2026-8-12", LAYER_ORDER).date).toBeUndefined();
    expect(decodeUrlState("d=2026-08-12", LAYER_ORDER).date).toBe("2026-08-12");
  });

  it("drops an unrecognised filter or view rather than throwing", () => {
    expect(decodeUrlState("f=catastrophic", LAYER_ORDER).filter).toBeUndefined();
    expect(decodeUrlState("v=satellite", LAYER_ORDER).view).toBeUndefined();
  });

  it("drops unknown layer ids from the hidden list and keeps the known ones", () => {
    const decoded = decodeUrlState("off=waterways,not-a-real-layer,flood-barrier", LAYER_ORDER);
    expect(decoded.hiddenLayers).toEqual(["waterways", "flood-barrier"]);
  });

  it("omits hiddenLayers entirely when nothing in the list is recognised", () => {
    expect(decodeUrlState("off=bogus-one,bogus-two", LAYER_ORDER).hiddenLayers).toBeUndefined();
  });

  it("accepts an arbitrary, non-empty project id without validating it against data", () => {
    // Validating that the id actually names a project is the caller's job
    // (App.tsx checks it against the loaded feature collection); this module
    // only has to not corrupt or drop a well-formed value.
    expect(decodeUrlState("p=demo-ps-malolos", LAYER_ORDER).projectId).toBe("demo-ps-malolos");
  });
});

describe("hiddenLayersOf / layersFromHidden", () => {
  it("finds nothing hidden when every layer is on", () => {
    expect(hiddenLayersOf(ALL_ON)).toEqual([]);
  });

  it("lists exactly the layers turned off", () => {
    const layers = { ...ALL_ON, "river-works": false, "flood-zones": false };
    expect(hiddenLayersOf(layers).sort()).toEqual(["flood-zones", "river-works"].sort());
  });

  it("round-trips through hiddenLayersOf and layersFromHidden", () => {
    const layers = { ...ALL_ON, "drainage-channel": false };
    const rebuilt = layersFromHidden(LAYER_ORDER, hiddenLayersOf(layers));
    expect(rebuilt).toEqual(layers);
  });

  it("turns every layer on when the hidden list is empty or undefined", () => {
    expect(layersFromHidden(LAYER_ORDER, [])).toEqual(ALL_ON);
    expect(layersFromHidden(LAYER_ORDER, undefined)).toEqual(ALL_ON);
  });

  it("ignores an id in the hidden list that is not a known layer", () => {
    const rebuilt = layersFromHidden(LAYER_ORDER, ["waterways", "not-a-layer" as LayerId]);
    expect(rebuilt.waterways).toBe(false);
    expect(Object.keys(rebuilt)).toHaveLength(LAYER_ORDER.length);
  });
});

describe("buildShareableUrl", () => {
  it("omits the question mark when there is nothing to encode", () => {
    expect(buildShareableUrl("https://example.org", "/", {})).toBe("https://example.org/");
  });

  it("appends the encoded query string", () => {
    const url = buildShareableUrl("https://example.org", "/", { date: "2026-08-12", filter: "flood" });
    expect(url).toBe("https://example.org/?d=2026-08-12&f=flood");
  });
});
