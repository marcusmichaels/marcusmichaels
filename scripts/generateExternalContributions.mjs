const fs = await import("node:fs/promises");

const USERNAME = "marcusmichaels";
const GITHUB_TOKEN = ""; // only needed if I get rate limited

const MAX_REPOS = 50;
const PER_PAGE = 100;

function formatTimestamp(date = new Date()) {
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function authHeaders() {
  const headers = { "User-Agent": "external-merged-contributions" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/**
 * Paginate through ALL merged PR search results (up to GitHub's 1000 limit).
 * Returns an array of [pr_api_url, closed_at] tuples.
 */
async function searchMergedPRs(username) {
  const q = `type:pr+author:${username}+is:merged`;
  const allItems = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/search/issues?q=${q}&per_page=${PER_PAGE}&page=${page}`;
    console.log(`📄 Fetching search results page ${page}...`);
    const data = await fetchJson(url);

    allItems.push(...data.items);

    // Stop if we've fetched all results or hit GitHub's 1000-result cap
    if (allItems.length >= data.total_count || data.items.length < PER_PAGE || allItems.length >= 1000) {
      break;
    }

    page++;
  }

  console.log(`🔍 Found ${allItems.length} merged PRs total`);

  return allItems.map((pr) => [pr.pull_request.url, pr.closed_at]);
}

async function getRepoDetails(fullName) {
  const repoUrl = `https://api.github.com/repos/${fullName}`;
  const repo = await fetchJson(repoUrl);
  return {
    name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description ?? "",
    language: repo.language ?? "Unknown",
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    license: repo.license?.spdx_id === "NOASSERTION" ? "Custom" : (repo.license?.spdx_id ?? "Unknown"),
    homepage: repo.homepage ?? "",
    avatar_url: repo.owner.avatar_url,
    owner: repo.owner.login,
    owner_type: repo.owner.type,
  };
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Parse existing repo entries from the README contributions table.
 * Returns an array of repo objects with fields matching what generateMarkdownTable expects.
 */
function parseExistingRepos(readmeContent) {
  const tag = "CONTRIBUTIONS";
  const pattern = new RegExp(`<!-- ${tag} START -->([\\s\\S]*?)<!-- ${tag} END -->`, "m");
  const match = readmeContent.match(pattern);
  if (!match) return [];

  const section = match[1];
  const lines = section.split("\n").filter((line) => line.startsWith("|"));

  // Skip the header row and separator row
  const dataLines = lines.slice(2);

  const repos = [];
  for (const line of dataLines) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 7) continue;

    // Parse: Logo | Repository | Stars | Language | License | Website | Last Contribution
    const logoCell = cells[0]; // ![owner](https://avatars.githubusercontent.com/u/ID?s=60)
    const repoCell = cells[1]; // [owner/repo](url)
    const stars = parseInt(cells[2], 10) || 0;
    const language = cells[3];
    const license = cells[4];
    const websiteCell = cells[5]; // [hostname](url) or empty
    const lastContribCell = cells[6];

    // Extract owner from logo alt text
    const ownerMatch = logoCell.match(/!\[([^\]]+)\]/);
    const owner = ownerMatch ? ownerMatch[1] : "";

    // Extract avatar user ID from logo URL
    const avatarIdMatch = logoCell.match(/\/u\/(\d+)/);
    const avatarId = avatarIdMatch ? avatarIdMatch[1] : "0";

    // Extract repo name and URL
    const repoMatch = repoCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const name = repoMatch ? repoMatch[1] : "";
    const html_url = repoMatch ? repoMatch[2] : "";

    // Extract homepage URL
    const homepageMatch = websiteCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const homepage = homepageMatch ? homepageMatch[2] : "";

    // Parse the last contribution date back to an ISO-ish string
    let last_contribution = "";
    if (lastContribCell) {
      const parsed = new Date(lastContribCell);
      if (!isNaN(parsed.getTime())) {
        last_contribution = parsed.toISOString();
      }
    }

    repos.push({
      name,
      html_url,
      description: "",
      language,
      stars,
      forks: 0,
      license,
      homepage,
      avatar_url: `https://avatars.githubusercontent.com/u/${avatarId}?s=60`,
      owner,
      owner_type: "Organization",
      last_contribution,
    });
  }

  return repos;
}

async function updateReadme(markdown) {
  const tag = "CONTRIBUTIONS";
  const readmePath = "README.md";
  const readme = await fs.readFile(readmePath, "utf-8");

  const pattern = new RegExp(`<!-- ${tag} START -->([\\s\\S]*?)<!-- ${tag} END -->`, "m");

  const replacement = `<!-- ${tag} START -->\n\n${markdown}\n<!-- ${tag} END -->`;

  const updated = readme.match(pattern) ? readme.replace(pattern, replacement) : readme + `\n\n${replacement}`;

  await fs.writeFile(readmePath, updated, "utf-8");
}

function extractUserId(avatarUrl) {
  const match = avatarUrl.match(/\/u\/(\d+)/);
  return match ? match[1] : "0";
}

function generateMarkdownTable(repos) {
  let md = `## Open source contributions: <sub><sup>Last generated: ${formatTimestamp()}</sup></sub>\n\n`;

  md += `| Logo | Repository | Stars | Language | License | Website | Last Contribution |\n`;
  md += `|------|------------|---------|-------------|-------------|-------------|----------------------|\n`;

  for (const repo of repos) {
    const logo = `![${repo.owner}](https://avatars.githubusercontent.com/u/${extractUserId(repo.avatar_url)}?s=60)`;
    const repoLink = `[${repo.name}](${repo.html_url})`;
    const homepage = repo.homepage ? `[${new URL(repo.homepage).hostname}](${repo.homepage})` : "";
    const stars = repo.stars;
    const lang = repo.language;
    const license = repo.license;
    const last = repo.last_contribution ? formatDate(repo.last_contribution) : "";

    md += `| ${logo} | ${repoLink} | ${stars} | ${lang} | ${license} | ${homepage} | ${last} |\n`;
  }

  return md;
}

async function main() {
  try {
    // 1. Load existing repos from README so we never lose them
    const readmePath = "README.md";
    const readmeContent = await fs.readFile(readmePath, "utf-8");
    const existingRepos = parseExistingRepos(readmeContent);
    const existingRepoNames = new Set(existingRepos.map((r) => r.name));

    console.log(`📋 Found ${existingRepos.length} existing repos in README`);

    // 2. Fetch all merged PRs (paginated)
    const mergedPRs = await searchMergedPRs(USERNAME);
    const seen = new Set();
    const freshRepos = [];

    for (const [prUrl, lastDate] of mergedPRs) {
      const prDetailsUrl = prUrl.includes("https://") ? prUrl : null;
      if (!prDetailsUrl) continue;

      try {
        const prDetails = await fetchJson(prDetailsUrl);
        const fullName = prDetails.base.repo.full_name;

        if (seen.has(fullName)) continue;
        seen.add(fullName);

        const repo = await getRepoDetails(fullName);
        const isExternal = repo.owner.toLowerCase() !== USERNAME.toLowerCase();
        const isPopular = repo.stars >= 100;

        if (isExternal && isPopular) {
          repo.last_contribution = lastDate;
          freshRepos.push(repo);
        }

        if (freshRepos.length >= MAX_REPOS) break;
      } catch (err) {
        console.warn(`⚠️ Failed to fetch PR/repo details for: ${prUrl}`);
      }
    }

    console.log(`🆕 Found ${freshRepos.length} repos from GitHub search`);

    // 3. Merge: fresh repos update existing ones, new ones get prepended
    const mergedMap = new Map();

    // Start with existing repos (keyed by name)
    for (const repo of existingRepos) {
      mergedMap.set(repo.name, repo);
    }

    // Fresh repos override existing data (updated stars, language, etc.)
    // and new repos are tracked separately for prepending
    const newRepoNames = [];
    for (const repo of freshRepos) {
      if (!mergedMap.has(repo.name)) {
        newRepoNames.push(repo.name);
      }
      mergedMap.set(repo.name, repo);
    }

    // 4. Build final list: all repos sorted by last contribution date (descending)
    const finalRepos = [...mergedMap.values()].sort((a, b) => new Date(b.last_contribution) - new Date(a.last_contribution));

    console.log(`✅ Final list: ${finalRepos.length} repos (${newRepoNames.length} new)`);

    if (newRepoNames.length > 0) {
      console.log(`   New repos: ${newRepoNames.join(", ")}`);
    }

    const markdown = generateMarkdownTable(finalRepos);
    await updateReadme(markdown);

    console.log(`📝 README.md updated`);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
