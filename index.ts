import { homedir } from "os";
import { spawn } from "bun";

interface CodeReview {
  files: string[];
  review: string;
}

class CodeReviewBot {
  private readonly model: string;
  private readonly excludePatterns = [
    /\.graphql$/, // Exclude .graphql files
    /\/test-utils\//, // Exclude test-utils folder
    /\/generated\//, // Exclude generated files
    /CHANGELOG\.md$/,
    /\.release-manifest\.json$/,
  ];

  constructor(model: string = "llama3.2") {
    this.model = model;
    console.log(`🤖 Initializing code reviewer with model: ${model}`);
  }

  private shouldIncludeFile(file: string): boolean {
    return !this.excludePatterns.some(pattern => pattern.test(file));
  }

  private log(message: string, error = false) {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = error ? "❌" : "📝";
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  private async execGit(command: string[], cwd: string): Promise<string> {
    this.log(`Running git command: ${command.join(" ")}`);

    const proc = spawn({
      cmd: command,
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    if (error && !output) {
      this.log(`Git command failed: ${error}`, true);
      throw new Error(error);
    }

    return output.trim();
  }

  private async generateReview(diff: string): Promise<string> {
    const prompt = `You are an expert code reviewer conversant in React, Tailwind css and web development. Review the following code changes in the context of the project.

Focus your analysis on:
1. Code correctness and potential bugs
2. Design patterns and architectural choices
3. Performance implications
4. Security vulnerabilities
5. Testing requirements
6. Code maintainability and readability

For each issue found:
- Specify the exact location
- Explain the problem
- Provide a concrete suggestion for improvement
- Rate the severity (Low/Medium/High)

Here's the diff:
${diff}

Format your response as:
### Summary
[Brief overview of changes]

### Critical Issues
[High severity issues]

### Improvements Needed
[Medium/Low severity issues]

### Best Practices
[Style and convention suggestions]

### Security & Performance
[Security and performance considerations]`;

    this.log(`Generating review using ${this.model}...`);

    try {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.log("Review generated successfully");
      return data.response;
    } catch (error) {
      this.log(`Failed to generate review: ${error}`, true);
      return `Error generating review: ${error}`;
    }
  }

  public async review(
    repoPath: string,
    branch: string,
    baseBranch: string = "main"
  ): Promise<CodeReview> {
    const fullPath = repoPath.replace(/^~/, homedir());
    this.log(`Reviewing repository at: ${fullPath}`);
    this.log(`Comparing ${branch} against ${baseBranch}`);

    try {
      // Get list of changed files between branches
      const filesOutput = await this.execGit(
        ["git", "diff", "--name-only", `${baseBranch}...${branch}`],
        fullPath
      );
      const allFiles = filesOutput.split("\n").filter(Boolean);

      // Filter out excluded files
      const files = allFiles.filter(file => this.shouldIncludeFile(file));

      this.log(
        `Found ${files.length} relevant files (${
          allFiles.length - files.length
        } files excluded)`
      );

      if (files.length === 0) {
        return {
          files: [],
          review:
            "No relevant files to review (all changed files were excluded by filters)",
        };
      }

      // Get diff only for included files
      const diffs = await Promise.all(
        files.map(file =>
          this.execGit(
            ["git", "diff", `${baseBranch}...${branch}`, "--", file],
            fullPath
          )
        )
      );

      const combinedDiff = diffs.join("\n\n");

      if (!combinedDiff) {
        this.log("No changes detected in relevant files");
        return {
          files,
          review: "No changes detected in relevant files",
        };
      }

      this.log(`Generated diff (${combinedDiff.length} characters)`);
      const review = await this.generateReview(combinedDiff);
      return { files, review };
    } catch (error) {
      this.log(`Review failed: ${error}`, true);
      throw new Error(`Failed to review code: ${error}`);
    }
  }
}

async function main() {
  console.log("\n🔍 Starting code review process...\n");

  const args = {
    repo: process.argv.find(arg => arg.startsWith("--repo="))?.split("=")[1],
    branch: process.argv
      .find(arg => arg.startsWith("--branch="))
      ?.split("=")[1],
    base:
      process.argv.find(arg => arg.startsWith("--base="))?.split("=")[1] ||
      "main",
    model:
      process.argv.find(arg => arg.startsWith("--model="))?.split("=")[1] ||
      "llama3.2",
  };

  if (!args.repo || !args.branch) {
    console.log(`
📋 Usage: bun run review.ts --repo=<path> --branch=<branch> [--base=<base-branch>] [--model=<model>]

Examples:
    bun run review.ts --repo=~/Projects/myapp --branch=feature/new-feature
    bun run review.ts --repo=~/Projects/myapp --branch=feature/new-feature --base=develop
    bun run review.ts --repo=~/Projects/myapp --branch=feature/new-feature --model=llama2:3b

Note: The following files are automatically excluded:
- .graphql files
- Files in test-utils folders
- Generated files
- CHANGELOG.md
- .release-manifest.json
`);
    process.exit(1);
  }

  try {
    const reviewer = new CodeReviewBot(args.model);
    const { files, review } = await reviewer.review(
      args.repo,
      args.branch,
      args.base
    );

    console.log("\n" + "=".repeat(50));
    console.log("📄 Files Changed:");
    console.log("-".repeat(20));
    files.forEach(file => console.log(`  • ${file}`));

    console.log("\n📊 Review Results:");
    console.log("-".repeat(20));
    console.log(review);
    console.log("=".repeat(50) + "\n");

    console.log("✅ Review completed successfully!\n");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
