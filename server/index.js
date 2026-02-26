const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4000;
const GITHUB_API = "https://api.github.com";

// ── Health check ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "PipeForge backend running ✅" });
});

// ── Get user profile ──────────────────────────────────────────
// Called after user pastes their GitHub token
app.get("/github/user", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const response = await axios.get(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(401).json({ error: "Invalid GitHub token" });
  }
});

// ── Get user repositories ─────────────────────────────────────
app.get("/github/repos", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const response = await axios.get(
      `${GITHUB_API}/user/repos?sort=updated&per_page=50&type=owner`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    // Return just what we need
    const repos = response.data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      html_url: r.html_url,
    }));
    res.json(repos);
  } catch (err) {
    res.status(400).json({ error: "Failed to fetch repos" });
  }
});

// ── Push YAML to GitHub repo ──────────────────────────────────
app.post("/github/push", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });

  const { repo, yaml, format, filename } = req.body;
  // format: "github" → .github/workflows/ci.yml
  // format: "gitlab" → .gitlab-ci.yml
  const filePath =
    format === "gitlab" ? ".gitlab-ci.yml" : ".github/workflows/ci.yml";
  const finalFilename = filename || filePath;

  try {
    // Check if file already exists (to get its SHA for update)
    let sha = null;
    try {
      const existing = await axios.get(
        `${GITHUB_API}/repos/${repo}/contents/${finalFilename}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
      sha = existing.data.sha;
    } catch {
      // File doesn't exist yet — that's fine, we'll create it
    }

    // Create or update the file
    const body = {
      message: sha
        ? "Update CI/CD pipeline via PipeForge"
        : "Add CI/CD pipeline via PipeForge",
      content: Buffer.from(yaml).toString("base64"),
    };
    if (sha) body.sha = sha;

    await axios.put(
      `${GITHUB_API}/repos/${repo}/contents/${finalFilename}`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    res.json({
      success: true,
      message: sha ? "Pipeline updated!" : "Pipeline created!",
      file: finalFilename,
      repo,
      url: `https://github.com/${repo}/blob/HEAD/${finalFilename}`,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(400).json({
      error: err.response?.data?.message || "Failed to push to GitHub",
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 PipeForge backend running at http://localhost:${PORT}`);
  console.log(`📡 GitHub API proxy ready\n`);
});

