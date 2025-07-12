const USERNAME = "marcusmichaels";
const GITHUB_TOKEN = ""; // only needed if I get rate limited

const MAX_REPOS = 50;
const PER_PAGE = 100;

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

async function searchMergedPRs(username) {
  const q = `type:pr+author:${username}+is:merged`;
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${PER_PAGE}`;
  const data = await fetchJson(url);

  // Map: { "owner/repo" → ISO date string }
  const latestDateByRepo = new Map();

  for (const pr of data.items) {
    const fullName = pr.repository_url.split("/").slice(-2).join("/");
    const closedAt = pr.closed_at;

    if (!latestDateByRepo.has(fullName)) {
      latestDateByRepo.set(fullName, closedAt);
    } else if (new Date(closedAt) > new Date(latestDateByRepo.get(fullName))) {
      latestDateByRepo.set(fullName, closedAt);
    }
  }

  return data.items.map((pr) => [pr.pull_request.url, pr.closed_at]);
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
    license: repo.license?.spdx_id ?? "Unknown",
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
  let md = `## Open source contributions:\n\n`;
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
    const mergedPRs = await searchMergedPRs(USERNAME);
    const seen = new Set();
    const repos = [];

    for (const [_, lastDate] of mergedPRs) {
      const prDetailsUrl = _.includes("https://") ? _ : null;
      if (!prDetailsUrl) continue;

      try {
        const prDetails = await fetchJson(prDetailsUrl);
        const repoUrl = prDetails.base.repo.url;
        const fullName = prDetails.base.repo.full_name;

        if (seen.has(fullName)) continue;
        seen.add(fullName);

        const repo = await getRepoDetails(fullName);
        const isExternal = repo.owner.toLowerCase() !== USERNAME.toLowerCase();
        const isPopular = repo.stars >= 100;

        if (isExternal && isPopular) {
          repo.last_contribution = lastDate;
          repos.push(repo);
        }

        if (repos.length >= MAX_REPOS) break;
      } catch (err) {
        console.warn(`⚠️ Failed to fetch PR/repo details`);
      }
    }

    const markdown = generateMarkdownTable(repos);
    await updateReadme(markdown);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
