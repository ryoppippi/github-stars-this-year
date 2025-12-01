import pLimit from "p-limit";
import { $ } from "bun";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_URL = "https://api.github.com";

interface Repository {
  name: string;
  full_name: string;
  stargazers_count: number;
  html_url: string;
  private: boolean;
}

interface StargazerEvent {
  starred_at: string;
  user: {
    login: string;
  };
}

interface RepoStarResult {
  name: string;
  fullName: string;
  totalStars: number;
  starsThisYear: number;
  url: string;
}

function fetchWithAuth(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function getAuthenticatedUser(): Promise<string> {
  const result = await $`gh api user --jq '.login'`.text();
  return result.trim();
}

async function getPublicRepos(username: string): Promise<Repository[]> {
  const repos: Repository[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetchWithAuth(
      `${GITHUB_API_URL}/users/${username}/repos?type=owner&per_page=${perPage}&page=${page}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch repositories: ${response.statusText}`);
    }

    const data = (await response.json()) as Repository[];
    if (data.length === 0) break;

    repos.push(...data.filter((repo) => !repo.private));
    if (data.length < perPage) break;
    page++;
  }

  return repos;
}

async function getStarsThisYear(owner: string, repo: string): Promise<number> {
  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(currentYear, 0, 1).toISOString();
  let starsThisYear = 0;
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.star+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) return 0;
      throw new Error(`Failed to fetch stargazers for ${owner}/${repo}: ${response.statusText}`);
    }

    const data = (await response.json()) as StargazerEvent[];
    if (data.length === 0) break;

    for (const star of data) {
      if (star.starred_at >= startOfYear) {
        starsThisYear++;
      }
    }

    // If the oldest star on this page is before start of year, we can stop
    const oldestStar = data[data.length - 1];
    if (oldestStar && oldestStar.starred_at < startOfYear) break;

    if (data.length < perPage) break;
    page++;
  }

  return starsThisYear;
}

if (import.meta.main) {
  if (!GITHUB_TOKEN) {
    console.error("Error: GITHUB_TOKEN environment variable is not set");
    console.error("Run this script with: gh do -e GITHUB_TOKEN -- bun run index.ts");
    process.exit(1);
  }

  const currentYear = new Date().getFullYear();

  console.log(`🌟 GitHub Stars Counter for ${currentYear}\n`);

  const username = await getAuthenticatedUser();
  console.log(`👤 Authenticated as: ${username}\n`);

  console.log("📦 Fetching public repositories...");
  const repos = await getPublicRepos(username);
  console.log(`   Found ${repos.length} public repositories\n`);

  // Filter repos with at least 1 star (to save API calls)
  const starredRepos = repos.filter((repo) => repo.stargazers_count > 0);
  console.log(`⭐ Checking ${starredRepos.length} repositories with stars...\n`);

  // Use p-limit for concurrent requests (5 concurrent)
  const limit = pLimit(5);

  const tasks = starredRepos.map((repo) =>
    limit(async (): Promise<RepoStarResult> => {
      const starsThisYear = await getStarsThisYear(username, repo.name);
      if (starsThisYear > 0) {
        console.log(`   ✓ ${repo.name}: +${starsThisYear} stars this year`);
      }
      return {
        name: repo.name,
        fullName: repo.full_name,
        totalStars: repo.stargazers_count,
        starsThisYear,
        url: repo.html_url,
      };
    })
  );

  const results = await Promise.all(tasks);

  // Sort by stars this year (descending)
  results.sort((a, b) => b.starsThisYear - a.starsThisYear);

  // Calculate totals
  const totalStarsThisYear = results.reduce((sum, r) => sum + r.starsThisYear, 0);
  const totalStarsAllTime = results.reduce((sum, r) => sum + r.totalStars, 0);

  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary");
  console.log("=".repeat(60));
  console.log(`\n🎯 Total stars earned in ${currentYear}: ${totalStarsThisYear}`);
  console.log(`📈 Total stars (all time): ${totalStarsAllTime}`);

  // Show top repos with new stars
  const reposWithNewStars = results.filter((r) => r.starsThisYear > 0);
  if (reposWithNewStars.length > 0) {
    console.log(`\n🏆 Top repositories with new stars in ${currentYear}:\n`);
    const top10 = reposWithNewStars.slice(0, 10);
    const maxNameLen = Math.max(...top10.map((r) => r.name.length));
    const maxStarsLen = Math.max(...top10.map((r) => String(r.starsThisYear).length));
    const maxTotalLen = Math.max(...top10.map((r) => String(r.totalStars).length));

    top10.forEach((repo, index) => {
      const rank = String(index + 1).padStart(2);
      const name = repo.name.padEnd(maxNameLen);
      const stars = String(repo.starsThisYear).padStart(maxStarsLen);
      const before = repo.totalStars - repo.starsThisYear;
      const beforeStr = String(before).padStart(maxTotalLen);
      const total = String(repo.totalStars).padStart(maxTotalLen);
      console.log(`   ${rank}. ${name}  +${stars} (${beforeStr} -> ${total})`);
    });
  }
}
