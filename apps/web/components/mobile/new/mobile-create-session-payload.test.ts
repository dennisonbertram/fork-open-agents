import { describe, expect, it } from "bun:test";
import { buildCreateSessionInput } from "./mobile-create-session-payload";

describe("buildCreateSessionInput", () => {
  it("returns sandboxType vercel always", () => {
    const result = buildCreateSessionInput({
      autoCommitPush: false,
      autoCreatePr: false,
    });
    expect(result.sandboxType).toBe("vercel");
  });

  describe("when no repo is selected", () => {
    it("omits all repo fields", () => {
      const result = buildCreateSessionInput({
        autoCommitPush: false,
        autoCreatePr: false,
      });
      expect(result.repoOwner).toBeUndefined();
      expect(result.repoName).toBeUndefined();
      expect(result.cloneUrl).toBeUndefined();
      expect(result.branch).toBeUndefined();
      expect(result.isNewBranch).toBe(false);
    });

    it("sets title when provided", () => {
      const result = buildCreateSessionInput({
        title: "Fix the bug",
        autoCommitPush: false,
        autoCreatePr: false,
      });
      expect(result.title).toBe("Fix the bug");
    });

    it("trims whitespace from title", () => {
      const result = buildCreateSessionInput({
        title: "  hello  ",
        autoCommitPush: false,
        autoCreatePr: false,
      });
      expect(result.title).toBe("hello");
    });

    it("omits title when blank", () => {
      const result = buildCreateSessionInput({
        title: "   ",
        autoCommitPush: false,
        autoCreatePr: false,
      });
      expect(result.title).toBeUndefined();
    });
  });

  describe("when repo is selected", () => {
    const baseRepo = {
      owner: "acme",
      name: "my-repo",
      cloneUrl: "https://github.com/acme/my-repo.git",
      branch: "main",
      isNewBranch: false,
    };

    it("sets all repo fields", () => {
      const result = buildCreateSessionInput({
        repo: baseRepo,
        autoCommitPush: true,
        autoCreatePr: false,
      });
      expect(result.repoOwner).toBe("acme");
      expect(result.repoName).toBe("my-repo");
      expect(result.cloneUrl).toBe("https://github.com/acme/my-repo.git");
      expect(result.branch).toBe("main");
      expect(result.isNewBranch).toBe(false);
    });

    it("passes isNewBranch true when set", () => {
      const result = buildCreateSessionInput({
        repo: { ...baseRepo, isNewBranch: true, branch: "feat/new" },
        autoCommitPush: true,
        autoCreatePr: false,
      });
      expect(result.isNewBranch).toBe(true);
      expect(result.branch).toBe("feat/new");
    });
  });

  describe("autoCreatePr", () => {
    it("is false when autoCommitPush is false, even if autoCreatePr is true", () => {
      const result = buildCreateSessionInput({
        autoCommitPush: false,
        autoCreatePr: true,
      });
      expect(result.autoCreatePr).toBe(false);
    });

    it("is passed through when autoCommitPush is true", () => {
      const result = buildCreateSessionInput({
        autoCommitPush: true,
        autoCreatePr: true,
      });
      expect(result.autoCreatePr).toBe(true);
    });

    it("is false when both flags are false", () => {
      const result = buildCreateSessionInput({
        autoCommitPush: false,
        autoCreatePr: false,
      });
      expect(result.autoCreatePr).toBe(false);
    });
  });
});
