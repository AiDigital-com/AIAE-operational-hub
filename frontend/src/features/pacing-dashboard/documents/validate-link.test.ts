import { describe, expect, it } from "vitest";
import { isAsanaProjectUrl, validateCampaignLink } from "./validate-link";

describe("validateCampaignLink", () => {
  it("should accept ordinary http and https links", () => {
    // Given / When / Then: the §16 happy path - any absolute web URL is a legitimate bookmark
    expect(validateCampaignLink("IO", "https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(validateCampaignLink("DV360", "http://displayvideo.google.com/ng_nav/p/1")).toBeNull();
    expect(validateCampaignLink("Contract", " https://example.com/contract.pdf ".trim())).toBeNull();
  });

  it("should reject anything that is not an absolute http(s) URL", () => {
    // Given: the Hub renders these clickable, so a stored javascript: URL is a script click later
    expect(validateCampaignLink("IO", "javascript:alert(1)")).toMatch(/http:\/\/ or https:\/\//);
    expect(validateCampaignLink("IO", "data:text/html,x")).toMatch(/http:\/\/ or https:\/\//);
    expect(validateCampaignLink("IO", "ftp://files.example.com/x")).toMatch(/http:\/\/ or https:\/\//);
    expect(validateCampaignLink("IO", "just words")).toMatch(/http:\/\/ or https:\/\//);
    expect(validateCampaignLink("IO", "")).toMatch(/http:\/\/ or https:\/\//);
  });

  it("should require a name", () => {
    expect(validateCampaignLink("   ", "https://example.com")).toBe("Every link needs a name.");
  });

  it("should enforce the contract's length caps", () => {
    // Given: one character over each cap
    expect(validateCampaignLink("x".repeat(121), "https://example.com")).toMatch(/name is too long/);
    expect(validateCampaignLink("IO", "https://example.com/" + "a".repeat(2048))).toMatch(/URL is too long/);
  });

  it("should apply the Asana project rule to the Asana slot only (US-141)", () => {
    // Given: the preset slot must look like an Asana project link; a custom link that merely
    // mentions Asana in its name is not the slot
    expect(validateCampaignLink("Asana", "https://example.com/asana")).toMatch(/Asana project/);
    expect(validateCampaignLink("Asana", "https://app.asana.com/0/123/456")).toBeNull();
    expect(validateCampaignLink("Asana runbook", "https://example.com/asana")).toBeNull();
  });
});

describe("isAsanaProjectUrl", () => {
  it("should accept both project URL shapes Asana has shipped", () => {
    expect(isAsanaProjectUrl("https://app.asana.com/0/1201234567890/list")).toBe(true);
    expect(isAsanaProjectUrl("https://app.asana.com/1/1200000000000000/project/120123/list")).toBe(true);
  });

  it("should reject the bare front page and foreign hosts", () => {
    expect(isAsanaProjectUrl("https://app.asana.com/")).toBe(false);
    expect(isAsanaProjectUrl("https://app.asana.com")).toBe(false);
    expect(isAsanaProjectUrl("https://notasana.com/0/123/456")).toBe(false);
    expect(isAsanaProjectUrl("https://example.com/asana")).toBe(false);
  });
});
