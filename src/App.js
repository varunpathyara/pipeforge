/* eslint-disable */
import { useState, useCallback, useRef, useEffect } from "react";
import ReactFlow, {
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Handle,
  Position,
  MarkerType,
  Panel,
} from "reactflow";
import "reactflow/dist/style.css";

const BACKEND = "http://localhost:4000";

// ─── GITHUB ACTIONS YAML GENERATOR ─────────────────────────────────────────────
function generateGitHubActionsYAML(nodes, edges) {
  if (nodes.length === 0) return "# Drag blocks onto the canvas to start building your pipeline";
  const triggerNode = nodes.find((n) => n.data.type === "trigger");
  const jobNodes = nodes.filter((n) => n.data.type !== "trigger");
  let yaml = `name: ${triggerNode?.data?.label || "My Pipeline"}\n\n`;
  const trigger = triggerNode?.data?.config?.trigger || "push";
  const branch = triggerNode?.data?.config?.branch || "main";
  if (trigger === "push" || trigger === "pull_request") {
    yaml += `on:\n  ${trigger}:\n    branches: ["${branch}"]\n\n`;
  } else if (trigger === "schedule") {
    yaml += `on:\n  schedule:\n    - cron: "${triggerNode?.data?.config?.cron || "0 0 * * *"}"\n\n`;
  } else {
    yaml += `on: [${trigger}]\n\n`;
  }
  if (jobNodes.length === 0) return yaml + "# Add job blocks to define your pipeline steps";
  yaml += `jobs:\n`;
  jobNodes.forEach((node) => {
    const jobId = node.data.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const runsOn = node.data.config?.runsOn || "ubuntu-latest";
    const deps = edges.filter((e) => e.target === node.id).map((e) => {
      const src = nodes.find((n) => n.id === e.source);
      if (!src || src.data.type === "trigger") return null;
      return src.data.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    }).filter(Boolean);
    yaml += `\n  ${jobId}:\n    runs-on: ${runsOn}\n`;
    if (deps.length > 0) yaml += `    needs: [${deps.join(", ")}]\n`;
    yaml += `    steps:\n`;
    if (node.data.config?.checkout !== false) yaml += `      - name: Checkout code\n        uses: actions/checkout@v4\n\n`;
    if (node.data.blockType === "node_test" || node.data.blockType === "node_build") {
      const v = node.data.config?.nodeVersion || "20";
      yaml += `      - name: Setup Node.js\n        uses: actions/setup-node@v4\n        with:\n          node-version: "${v}"\n\n`;
      yaml += `      - name: Install dependencies\n        run: npm ci\n\n`;
    }
    if (node.data.blockType === "python_test" || node.data.blockType === "python_build") {
      const v = node.data.config?.pythonVersion || "3.11";
      yaml += `      - name: Setup Python\n        uses: actions/setup-python@v4\n        with:\n          python-version: "${v}"\n\n`;
      yaml += `      - name: Install dependencies\n        run: pip install -r requirements.txt\n\n`;
    }
    if (node.data.blockType === "go_build") {
      const v = node.data.config?.goVersion || "1.21";
      yaml += `      - name: Setup Go\n        uses: actions/setup-go@v4\n        with:\n          go-version: "${v}"\n\n`;
    }
    if (node.data.blockType === "docker_build") {
      const img = node.data.config?.imageName || "my-app";
      yaml += `      - name: Set up Docker Buildx\n        uses: docker/setup-buildx-action@v3\n\n`;
      yaml += `      - name: Build Docker image\n        run: docker build -t ${img}:latest .\n\n`;
    }
    if (node.data.blockType === "cache") yaml += `      - name: Cache dependencies\n        uses: actions/cache@v3\n        with:\n          path: ~/.npm\n          key: \${{ runner.os }}-node-\${{ hashFiles('**/package-lock.json') }}\n\n`;
    const cmd = node.data.config?.command;
    if (cmd) {
      yaml += `      - name: ${node.data.label}\n        run: ${cmd}\n\n`;
    } else {
      if (node.data.blockType === "node_test") yaml += `      - name: Run tests\n        run: npm test\n\n`;
      if (node.data.blockType === "node_build") yaml += `      - name: Build application\n        run: npm run build\n\n`;
      if (node.data.blockType === "python_test") yaml += `      - name: Run tests\n        run: pytest\n\n`;
      if (node.data.blockType === "python_build") yaml += `      - name: Build package\n        run: python -m build\n\n`;
      if (node.data.blockType === "go_build") yaml += `      - name: Build\n        run: go build ./...\n\n      - name: Test\n        run: go test ./...\n\n`;
      if (node.data.blockType === "lint") yaml += `      - name: Run linter\n        run: npm run lint\n\n`;
      if (node.data.blockType === "security_scan") yaml += `      - name: Security scan\n        uses: snyk/actions/node@master\n        env:\n          SNYK_TOKEN: \${{ secrets.SNYK_TOKEN }}\n\n`;
      if (node.data.blockType === "deploy_vercel") yaml += `      - name: Deploy to Vercel\n        uses: amondnet/vercel-action@v25\n        with:\n          vercel-token: \${{ secrets.VERCEL_TOKEN }}\n          vercel-org-id: \${{ secrets.ORG_ID }}\n          vercel-project-id: \${{ secrets.PROJECT_ID }}\n\n`;
      if (node.data.blockType === "deploy_aws") yaml += `      - name: Deploy to AWS\n        uses: aws-actions/configure-aws-credentials@v4\n        with:\n          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}\n          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}\n          aws-region: us-east-1\n\n`;
      if (node.data.blockType === "deploy_gcp") yaml += `      - name: Deploy to GCP\n        uses: google-github-actions/deploy-cloudrun@v1\n        with:\n          service: my-service\n          region: us-central1\n          credentials: \${{ secrets.GCP_CREDENTIALS }}\n\n`;
      if (node.data.blockType === "notify_slack") yaml += `      - name: Notify Slack\n        uses: slackapi/slack-github-action@v1.26.0\n        with:\n          payload: '{"text":"Pipeline completed for \${{ github.repository }}"}'\n        env:\n          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}\n\n`;
    }
  });
  return yaml;
}

// ─── GITLAB CI YAML GENERATOR ──────────────────────────────────────────────────
function generateGitLabCIYAML(nodes, edges) {
  if (nodes.length === 0) return "# Drag blocks onto the canvas to start building your pipeline";
  const triggerNode = nodes.find((n) => n.data.type === "trigger");
  const jobNodes = nodes.filter((n) => n.data.type !== "trigger");
  const branch = triggerNode?.data?.config?.branch || "main";
  let yaml = `# GitLab CI Pipeline\n# Generated by PipeForge\n\ndefault:\n  image: ubuntu:latest\n\n`;
  const stages = [...new Set(jobNodes.map((n) => {
    if (n.data.blockType?.includes("test") || n.data.blockType === "lint" || n.data.blockType === "security_scan") return "test";
    if (n.data.blockType?.includes("build") || n.data.blockType === "cache" || n.data.blockType === "docker_build") return "build";
    if (n.data.blockType?.includes("deploy")) return "deploy";
    return "test";
  }))];
  yaml += `stages:\n${stages.map((s) => `  - ${s}`).join("\n")}\n\n`;
  jobNodes.forEach((node) => {
    const jobId = node.data.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    let stage = "test";
    if (node.data.blockType?.includes("build") || node.data.blockType === "docker_build") stage = "build";
    if (node.data.blockType?.includes("deploy")) stage = "deploy";
    const deps = edges.filter((e) => e.target === node.id).map((e) => {
      const src = nodes.find((n) => n.id === e.source);
      if (!src || src.data.type === "trigger") return null;
      return src.data.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    }).filter(Boolean);
    yaml += `${jobId}:\n  stage: ${stage}\n`;
    if (node.data.blockType === "node_test" || node.data.blockType === "node_build") yaml += `  image: node:${node.data.config?.nodeVersion || "20"}-alpine\n`;
    else if (node.data.blockType === "python_test" || node.data.blockType === "python_build") yaml += `  image: python:${node.data.config?.pythonVersion || "3.11"}-slim\n`;
    else if (node.data.blockType === "go_build") yaml += `  image: golang:${node.data.config?.goVersion || "1.21"}\n`;
    else if (node.data.blockType === "docker_build") yaml += `  image: docker:latest\n  services:\n    - docker:dind\n`;
    if (deps.length > 0) yaml += `  needs: [${deps.map((d) => `"${d}"`).join(", ")}]\n`;
    yaml += `  script:\n`;
    if (node.data.config?.command) yaml += `    - ${node.data.config.command}\n`;
    else {
      if (node.data.blockType === "node_test") yaml += `    - npm ci\n    - npm test\n`;
      if (node.data.blockType === "node_build") yaml += `    - npm ci\n    - npm run build\n`;
      if (node.data.blockType === "python_test") yaml += `    - pip install -r requirements.txt\n    - pytest\n`;
      if (node.data.blockType === "python_build") yaml += `    - pip install build\n    - python -m build\n`;
      if (node.data.blockType === "go_build") yaml += `    - go build ./...\n    - go test ./...\n`;
      if (node.data.blockType === "lint") yaml += `    - npm ci\n    - npm run lint\n`;
      if (node.data.blockType === "security_scan") yaml += `    - npm audit --audit-level=high\n`;
      if (node.data.blockType === "docker_build") yaml += `    - docker build -t ${node.data.config?.imageName || "my-app"}:latest .\n`;
      if (node.data.blockType === "deploy_vercel") yaml += `    - npx vercel --token=$VERCEL_TOKEN --prod\n`;
      if (node.data.blockType === "deploy_aws") yaml += `    - aws s3 sync ./build s3://my-bucket\n`;
      if (node.data.blockType === "notify_slack") yaml += `    - 'curl -X POST -H "Content-type: application/json" --data "{\\"text\\":\\"Pipeline complete\\"}" $SLACK_WEBHOOK_URL'\n`;
    }
    yaml += `  rules:\n    - if: $CI_COMMIT_BRANCH == "${branch}"\n\n`;
  });
  return yaml;
}

// ─── BLOCK DEFINITIONS ─────────────────────────────────────────────────────────
const BLOCK_CATEGORIES = [
  { name: "Triggers", icon: "⚡", blocks: [
    { type: "trigger", blockType: "trigger_push", label: "Push Trigger", icon: "🔀", color: "#6366f1", description: "Runs on git push", config: { trigger: "push", branch: "main" } },
    { type: "trigger", blockType: "trigger_pr", label: "Pull Request", icon: "🔃", color: "#8b5cf6", description: "Runs on PR open/sync", config: { trigger: "pull_request", branch: "main" } },
    { type: "trigger", blockType: "trigger_schedule", label: "Scheduled", icon: "🕐", color: "#7c3aed", description: "Runs on a cron schedule", config: { trigger: "schedule", cron: "0 0 * * *" } },
  ]},
  { name: "Test & Quality", icon: "🧪", blocks: [
    { type: "job", blockType: "node_test", label: "Node.js Tests", icon: "🟢", color: "#10b981", description: "npm ci + npm test", config: { nodeVersion: "20", checkout: true } },
    { type: "job", blockType: "python_test", label: "Python Tests", icon: "🐍", color: "#f59e0b", description: "pip install + pytest", config: { pythonVersion: "3.11", checkout: true } },
    { type: "job", blockType: "go_build", label: "Go Build & Test", icon: "🐹", color: "#06b6d4", description: "go build + go test", config: { goVersion: "1.21", checkout: true } },
    { type: "job", blockType: "lint", label: "Lint Code", icon: "🔍", color: "#0891b2", description: "Run ESLint/Prettier", config: { checkout: true } },
    { type: "job", blockType: "security_scan", label: "Security Scan", icon: "🔒", color: "#ef4444", description: "Snyk vulnerability scan", config: { checkout: true } },
  ]},
  { name: "Build", icon: "🔨", blocks: [
    { type: "job", blockType: "node_build", label: "Node.js Build", icon: "📦", color: "#3b82f6", description: "npm ci + npm run build", config: { nodeVersion: "20", checkout: true } },
    { type: "job", blockType: "python_build", label: "Python Build", icon: "🐍", color: "#d97706", description: "python -m build", config: { pythonVersion: "3.11", checkout: true } },
    { type: "job", blockType: "docker_build", label: "Docker Build", icon: "🐳", color: "#0ea5e9", description: "Build & tag Docker image", config: { imageName: "my-app", checkout: true } },
    { type: "job", blockType: "cache", label: "Cache Deps", icon: "💾", color: "#64748b", description: "Cache node_modules/pip", config: { checkout: false } },
  ]},
  { name: "Deploy", icon: "🚀", blocks: [
    { type: "job", blockType: "deploy_vercel", label: "Deploy Vercel", icon: "▲", color: "#6366f1", description: "Deploy to Vercel", config: { checkout: true } },
    { type: "job", blockType: "deploy_aws", label: "Deploy AWS", icon: "☁️", color: "#f97316", description: "Deploy to AWS", config: { checkout: true } },
    { type: "job", blockType: "deploy_gcp", label: "Deploy GCP", icon: "🌐", color: "#4285f4", description: "Deploy to Google Cloud", config: { checkout: true } },
    { type: "job", blockType: "notify_slack", label: "Slack Notify", icon: "💬", color: "#4a154b", description: "Send Slack notification", config: { checkout: false } },
  ]},
];

// ─── TEMPLATES ──────────────────────────────────────────────────────────────────
const TEMPLATES = {
  nodejs: { name: "Node.js App", emoji: "🟢", nodes: [
    { id: "t1", type: "pipelineNode", position: { x: 300, y: 50 }, data: { type: "trigger", blockType: "trigger_push", label: "Push Trigger", icon: "🔀", color: "#6366f1", description: "Runs on git push", config: { trigger: "push", branch: "main" } } },
    { id: "j1", type: "pipelineNode", position: { x: 100, y: 220 }, data: { type: "job", blockType: "lint", label: "Lint Code", icon: "🔍", color: "#0891b2", description: "Run ESLint/Prettier", config: { checkout: true } } },
    { id: "j2", type: "pipelineNode", position: { x: 500, y: 220 }, data: { type: "job", blockType: "node_test", label: "Node.js Tests", icon: "🟢", color: "#10b981", description: "npm ci + npm test", config: { nodeVersion: "20", checkout: true } } },
    { id: "j3", type: "pipelineNode", position: { x: 300, y: 400 }, data: { type: "job", blockType: "node_build", label: "Node.js Build", icon: "📦", color: "#3b82f6", description: "npm ci + npm run build", config: { nodeVersion: "20", checkout: true } } },
    { id: "j4", type: "pipelineNode", position: { x: 300, y: 580 }, data: { type: "job", blockType: "deploy_vercel", label: "Deploy Vercel", icon: "▲", color: "#6366f1", description: "Deploy to Vercel", config: { checkout: true } } },
  ], edges: [{ id: "e1", source: "t1", target: "j1" }, { id: "e2", source: "t1", target: "j2" }, { id: "e3", source: "j1", target: "j3" }, { id: "e4", source: "j2", target: "j3" }, { id: "e5", source: "j3", target: "j4" }] },
  python: { name: "Python App", emoji: "🐍", nodes: [
    { id: "t1", type: "pipelineNode", position: { x: 300, y: 50 }, data: { type: "trigger", blockType: "trigger_push", label: "Push Trigger", icon: "🔀", color: "#6366f1", description: "Runs on git push", config: { trigger: "push", branch: "main" } } },
    { id: "j1", type: "pipelineNode", position: { x: 150, y: 220 }, data: { type: "job", blockType: "security_scan", label: "Security Scan", icon: "🔒", color: "#ef4444", description: "Snyk vulnerability scan", config: { checkout: true } } },
    { id: "j2", type: "pipelineNode", position: { x: 450, y: 220 }, data: { type: "job", blockType: "python_test", label: "Python Tests", icon: "🐍", color: "#f59e0b", description: "pip install + pytest", config: { pythonVersion: "3.11", checkout: true } } },
    { id: "j3", type: "pipelineNode", position: { x: 300, y: 400 }, data: { type: "job", blockType: "python_build", label: "Python Build", icon: "🐍", color: "#d97706", description: "python -m build", config: { pythonVersion: "3.11", checkout: true } } },
    { id: "j4", type: "pipelineNode", position: { x: 300, y: 580 }, data: { type: "job", blockType: "deploy_aws", label: "Deploy AWS", icon: "☁️", color: "#f97316", description: "Deploy to AWS", config: { checkout: true } } },
  ], edges: [{ id: "e1", source: "t1", target: "j1" }, { id: "e2", source: "t1", target: "j2" }, { id: "e3", source: "j1", target: "j3" }, { id: "e4", source: "j2", target: "j3" }, { id: "e5", source: "j3", target: "j4" }] },
  docker: { name: "Docker", emoji: "🐳", nodes: [
    { id: "t1", type: "pipelineNode", position: { x: 300, y: 50 }, data: { type: "trigger", blockType: "trigger_push", label: "Push Trigger", icon: "🔀", color: "#6366f1", description: "Runs on git push", config: { trigger: "push", branch: "main" } } },
    { id: "j1", type: "pipelineNode", position: { x: 300, y: 220 }, data: { type: "job", blockType: "security_scan", label: "Security Scan", icon: "🔒", color: "#ef4444", description: "Snyk vulnerability scan", config: { checkout: true } } },
    { id: "j2", type: "pipelineNode", position: { x: 300, y: 400 }, data: { type: "job", blockType: "docker_build", label: "Docker Build", icon: "🐳", color: "#0ea5e9", description: "Build & tag Docker image", config: { imageName: "my-app", checkout: true } } },
    { id: "j3", type: "pipelineNode", position: { x: 300, y: 580 }, data: { type: "job", blockType: "deploy_gcp", label: "Deploy GCP", icon: "🌐", color: "#4285f4", description: "Deploy to Google Cloud", config: { checkout: true } } },
  ], edges: [{ id: "e1", source: "t1", target: "j1" }, { id: "e2", source: "j1", target: "j2" }, { id: "e3", source: "j2", target: "j3" }] },
  fullstack: { name: "Full Stack", emoji: "🔥", nodes: [
    { id: "t1", type: "pipelineNode", position: { x: 300, y: 30 }, data: { type: "trigger", blockType: "trigger_pr", label: "Pull Request", icon: "🔃", color: "#8b5cf6", description: "Runs on PR open/sync", config: { trigger: "pull_request", branch: "main" } } },
    { id: "j1", type: "pipelineNode", position: { x: 80, y: 200 }, data: { type: "job", blockType: "lint", label: "Lint Code", icon: "🔍", color: "#0891b2", description: "Run ESLint/Prettier", config: { checkout: true } } },
    { id: "j2", type: "pipelineNode", position: { x: 300, y: 200 }, data: { type: "job", blockType: "node_test", label: "Node.js Tests", icon: "🟢", color: "#10b981", description: "npm ci + npm test", config: { nodeVersion: "20", checkout: true } } },
    { id: "j3", type: "pipelineNode", position: { x: 520, y: 200 }, data: { type: "job", blockType: "security_scan", label: "Security Scan", icon: "🔒", color: "#ef4444", description: "Snyk vulnerability scan", config: { checkout: true } } },
    { id: "j4", type: "pipelineNode", position: { x: 300, y: 390 }, data: { type: "job", blockType: "node_build", label: "Node.js Build", icon: "📦", color: "#3b82f6", description: "npm ci + npm run build", config: { nodeVersion: "20", checkout: true } } },
    { id: "j5", type: "pipelineNode", position: { x: 150, y: 570 }, data: { type: "job", blockType: "deploy_vercel", label: "Deploy Vercel", icon: "▲", color: "#6366f1", description: "Deploy to Vercel", config: { checkout: true } } },
    { id: "j6", type: "pipelineNode", position: { x: 450, y: 570 }, data: { type: "job", blockType: "notify_slack", label: "Slack Notify", icon: "💬", color: "#4a154b", description: "Send Slack notification", config: { checkout: false } } },
  ], edges: [{ id: "e1", source: "t1", target: "j1" }, { id: "e2", source: "t1", target: "j2" }, { id: "e3", source: "t1", target: "j3" }, { id: "e4", source: "j1", target: "j4" }, { id: "e5", source: "j2", target: "j4" }, { id: "e6", source: "j3", target: "j4" }, { id: "e7", source: "j4", target: "j5" }, { id: "e8", source: "j4", target: "j6" }] },
};

// ─── CUSTOM NODE ────────────────────────────────────────────────────────────────
function PipelineNode({ data, selected }) {
  return (
    <div style={{ background: selected ? `linear-gradient(135deg, ${data.color}33, ${data.color}22)` : "linear-gradient(135deg, #1e293b, #0f172a)", border: `2px solid ${selected ? data.color : data.color + "66"}`, borderRadius: "12px", padding: "12px 16px", minWidth: "180px", maxWidth: "220px", boxShadow: selected ? `0 0 20px ${data.color}44, 0 4px 20px rgba(0,0,0,0.4)` : "0 4px 20px rgba(0,0,0,0.4)", cursor: "pointer", transition: "all 0.2s ease", fontFamily: "'JetBrains Mono', monospace" }}>
      {data.type !== "trigger" && <Handle type="target" position={Position.Top} style={{ background: data.color, border: "2px solid #0f172a", width: 10, height: 10 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "20px" }}>{data.icon}</span>
        <div>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#f1f5f9" }}>{data.label}</div>
          <div style={{ fontSize: "9px", color: data.color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "600" }}>{data.type === "trigger" ? "TRIGGER" : "JOB"}</div>
        </div>
      </div>
      <div style={{ fontSize: "10px", color: "#94a3b8", borderTop: "1px solid #1e293b", paddingTop: "6px", lineHeight: "1.4" }}>{data.description}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, border: "2px solid #0f172a", width: 10, height: 10 }} />
    </div>
  );
}

const nodeTypes = { pipelineNode: PipelineNode };

const topBtnStyle = { background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", transition: "all 0.15s" };
const inputStyle = { display: "block", width: "100%", marginTop: "6px", background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", padding: "8px 10px", color: "#f1f5f9", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box" };

// ─── CONFIG PANEL ───────────────────────────────────────────────────────────────
function ConfigPanel({ node, onUpdate, onClose }) {
  const [config, setConfig] = useState(node?.data?.config || {});
  useEffect(() => { setConfig(node?.data?.config || {}); }, [node?.id]);
  if (!node) return null;
  const handleChange = (key, value) => { const nc = { ...config, [key]: value }; setConfig(nc); onUpdate(node.id, nc); };
  return (
    <div style={{ position: "absolute", right: "16px", top: "16px", width: "280px", background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155", borderRadius: "16px", padding: "20px", zIndex: 100, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", fontFamily: "'JetBrains Mono', monospace", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#f1f5f9" }}>{node.data.icon} {node.data.label}</div>
          <div style={{ fontSize: "10px", color: node.data.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>Configure Block</div>
        </div>
        <button onClick={onClose} style={{ background: "#334155", border: "none", color: "#94a3b8", cursor: "pointer", borderRadius: "6px", padding: "4px 8px", fontSize: "12px" }}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {node.data.type === "trigger" && (<>
          <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Branch<input value={config.branch || "main"} onChange={(e) => handleChange("branch", e.target.value)} style={inputStyle} /></label>
          {config.trigger === "schedule" && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Cron<input value={config.cron || "0 0 * * *"} onChange={(e) => handleChange("cron", e.target.value)} style={inputStyle} /></label>}
        </>)}
        {(node.data.blockType === "node_test" || node.data.blockType === "node_build") && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Node Version<select value={config.nodeVersion || "20"} onChange={(e) => handleChange("nodeVersion", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}><option value="18">18 LTS</option><option value="20">20 LTS</option><option value="21">21</option></select></label>}
        {(node.data.blockType === "python_test" || node.data.blockType === "python_build") && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Python Version<select value={config.pythonVersion || "3.11"} onChange={(e) => handleChange("pythonVersion", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}><option value="3.10">3.10</option><option value="3.11">3.11</option><option value="3.12">3.12</option></select></label>}
        {node.data.blockType === "docker_build" && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Image Name<input value={config.imageName || "my-app"} onChange={(e) => handleChange("imageName", e.target.value)} style={inputStyle} /></label>}
        {node.data.type === "job" && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Runner OS<select value={config.runsOn || "ubuntu-latest"} onChange={(e) => handleChange("runsOn", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}><option value="ubuntu-latest">Ubuntu Latest</option><option value="ubuntu-22.04">Ubuntu 22.04</option><option value="windows-latest">Windows Latest</option><option value="macos-latest">macOS Latest</option></select></label>}
        {node.data.type === "job" && <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Custom Command<input value={config.command || ""} onChange={(e) => handleChange("command", e.target.value)} style={inputStyle} placeholder="npm run custom" /></label>}
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px", fontSize: "10px", color: "#475569", lineHeight: "1.6" }}>💡 Changes reflect in YAML instantly</div>
      </div>
    </div>
  );
}

// ─── GITHUB PANEL ───────────────────────────────────────────────────────────────
function GitHubPanel({ yaml, yamlFormat, onClose }) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [status, setStatus] = useState(null); // null | "loading" | "success" | "error"
  const [message, setMessage] = useState("");
  const [pushedUrl, setPushedUrl] = useState("");

  const connect = async () => {
    if (!token.trim()) return;
    setStatus("loading");
    setMessage("Connecting to GitHub...");
    try {
      const res = await fetch(`${BACKEND}/github/user`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data);
      setMessage("Loading your repositories...");
      const repoRes = await fetch(`${BACKEND}/github/repos`, { headers: { Authorization: `Bearer ${token}` } });
      const repoData = await repoRes.json();
      setRepos(repoData);
      setStatus(null);
      setMessage("");
    } catch (err) {
      setStatus("error");
      setMessage(err.message || "Failed to connect");
    }
  };

  const pushToGitHub = async () => {
    if (!selectedRepo) return;
    setStatus("loading");
    setMessage("Pushing pipeline to GitHub...");
    try {
      const res = await fetch(`${BACKEND}/github/push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selectedRepo, yaml, format: yamlFormat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus("success");
      setMessage(data.message);
      setPushedUrl(data.url);
    } catch (err) {
      setStatus("error");
      setMessage(err.message || "Failed to push");
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155", borderRadius: "20px", padding: "28px", width: "480px", boxShadow: "0 40px 100px rgba(0,0,0,0.8)", fontFamily: "'JetBrains Mono', monospace" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#f1f5f9" }}>🐙 Push to GitHub</div>
            <div style={{ fontSize: "10px", color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>Deploy your pipeline directly</div>
          </div>
          <button onClick={onClose} style={{ background: "#334155", border: "none", color: "#94a3b8", cursor: "pointer", borderRadius: "8px", padding: "6px 10px", fontSize: "13px" }}>✕</button>
        </div>

        {/* Step 1 - Token */}
        {!user && (
          <div>
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: "600", textTransform: "uppercase", marginBottom: "8px" }}>Step 1 — Get your GitHub Token</div>
              <div style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.8" }}>
                1. Go to <span style={{ color: "#6366f1" }}>github.com → Settings</span><br />
                2. Click <span style={{ color: "#f1f5f9" }}>Developer settings</span><br />
                3. Click <span style={{ color: "#f1f5f9" }}>Personal access tokens → Tokens (classic)</span><br />
                4. Click <span style={{ color: "#f1f5f9" }}>Generate new token (classic)</span><br />
                5. Check <span style={{ color: "#10b981" }}>✓ repo</span> scope → Generate<br />
                6. Copy the token and paste it below
              </div>
            </div>
            <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>
              GitHub Personal Access Token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                style={{ ...inputStyle, marginTop: "8px" }}
                onKeyDown={(e) => e.key === "Enter" && connect()}
              />
            </label>
            <button onClick={connect} disabled={!token.trim() || status === "loading"}
              style={{ marginTop: "12px", width: "100%", padding: "10px", background: "#6366f1", border: "none", borderRadius: "10px", color: "#fff", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>
              {status === "loading" ? "⏳ Connecting..." : "Connect to GitHub →"}
            </button>
          </div>
        )}

        {/* Step 2 - Repo Selection */}
        {user && status !== "success" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", background: "#0f172a", borderRadius: "10px", marginBottom: "16px", border: "1px solid #10b98144" }}>
              <img src={user.avatar_url} alt="" style={{ width: "36px", height: "36px", borderRadius: "50%" }} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "#f1f5f9" }}>{user.name || user.login}</div>
                <div style={{ fontSize: "10px", color: "#10b981" }}>✓ Connected to GitHub</div>
              </div>
            </div>

            <label style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>
              Select Repository
              <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} style={{ ...inputStyle, cursor: "pointer", marginTop: "8px" }}>
                <option value="">-- Choose a repo --</option>
                {repos.map((r) => (
                  <option key={r.id} value={r.full_name}>{r.private ? "🔒" : "📂"} {r.full_name}</option>
                ))}
              </select>
            </label>

            <div style={{ marginTop: "12px", padding: "10px", background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", fontSize: "10px", color: "#475569", lineHeight: "1.6" }}>
              📄 Will create: <span style={{ color: "#6366f1" }}>{yamlFormat === "github" ? ".github/workflows/ci.yml" : ".gitlab-ci.yml"}</span>
            </div>

            <button onClick={pushToGitHub} disabled={!selectedRepo || status === "loading"}
              style={{ marginTop: "12px", width: "100%", padding: "10px", background: selectedRepo ? "#10b981" : "#1e293b", border: "none", borderRadius: "10px", color: selectedRepo ? "#fff" : "#475569", fontSize: "12px", fontWeight: "700", cursor: selectedRepo ? "pointer" : "not-allowed", fontFamily: "'JetBrains Mono', monospace", transition: "all 0.2s" }}>
              {status === "loading" ? "⏳ Pushing to GitHub..." : "🚀 Push Pipeline to GitHub"}
            </button>
          </div>
        )}

        {/* Success */}
        {status === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎉</div>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#10b981", marginBottom: "8px" }}>{message}</div>
            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "16px" }}>Your CI/CD pipeline is now live on GitHub!</div>
            <a href={pushedUrl} target="_blank" rel="noreferrer"
              style={{ display: "block", padding: "10px", background: "#6366f1", borderRadius: "10px", color: "#fff", textDecoration: "none", fontSize: "12px", fontWeight: "700", marginBottom: "10px" }}>
              View on GitHub →
            </a>
            <button onClick={onClose} style={{ width: "100%", padding: "8px", background: "#1e293b", border: "1px solid #334155", borderRadius: "10px", color: "#94a3b8", cursor: "pointer", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}>Close</button>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div style={{ marginTop: "12px", padding: "10px", background: "#ef444422", border: "1px solid #ef4444", borderRadius: "8px", fontSize: "11px", color: "#ef4444" }}>
            ❌ {message}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [yaml, setYaml] = useState("# Drag blocks onto the canvas to start building your pipeline");
  const [showYaml, setShowYaml] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [yamlFormat, setYamlFormat] = useState("github");
  const [showGitHub, setShowGitHub] = useState(false);
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const nodeIdCounter = useRef(0);

  useEffect(() => {
    setYaml(yamlFormat === "github" ? generateGitHubActionsYAML(nodes, edges) : generateGitLabCIYAML(nodes, edges));
  }, [nodes, edges, yamlFormat]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" }, style: { stroke: "#6366f1", strokeWidth: 2 }, animated: true }, eds)), []);
  const onNodeClick = useCallback((_, node) => { setSelectedNode(node); }, []);
  const onPaneClick = useCallback(() => { setSelectedNode(null); }, []);
  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const blockData = JSON.parse(e.dataTransfer.getData("application/reactflow"));
    const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => nds.concat({ id: `node_${++nodeIdCounter.current}`, type: "pipelineNode", position, data: { ...blockData } }));
  }, [reactFlowInstance]);

  const loadTemplate = (key) => {
    const tpl = TEMPLATES[key];
    setNodes(tpl.nodes);
    setEdges(tpl.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" }, style: { stroke: "#6366f1", strokeWidth: 2 }, animated: true })));
    setSelectedNode(null);
  };

  const updateNodeConfig = (nodeId, newConfig) => setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config: newConfig } } : n));

  const copyYaml = () => { navigator.clipboard.writeText(yaml); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const downloadYaml = () => {
    const filename = yamlFormat === "github" ? "ci.yml" : ".gitlab-ci.yml";
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true); setTimeout(() => setDownloaded(false), 2000);
  };

  const clearCanvas = () => { setNodes([]); setEdges([]); setSelectedNode(null); };

  const colorizeYaml = (line) => {
    if (line.trim().startsWith("#")) return "#475569";
    if (line.match(/^[a-zA-Z]/) && line.includes(":")) return "#6366f1";
    if (line.trim().startsWith("- name:") || line.trim().startsWith("name:")) return "#10b981";
    if (line.trim().startsWith("run:") || line.trim().startsWith("uses:") || line.trim().startsWith("- ")) return "#f59e0b";
    if (line.trim().startsWith("on:") || line.trim().startsWith("jobs:") || line.trim().startsWith("stages:")) return "#e879f9";
    if (line.trim().startsWith("image:")) return "#38bdf8";
    return "#94a3b8";
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#020617", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .block-item:hover { transform: translateX(4px); border-color: var(--color) !important; background: #1e293b !important; }
        .block-item { transition: all 0.15s ease; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .react-flow__controls { background: #1e293b !important; border: 1px solid #334155 !important; border-radius: 10px !important; }
        .react-flow__controls button { background: #1e293b !important; border-color: #334155 !important; color: #94a3b8 !important; }
        .react-flow__controls button:hover { background: #334155 !important; }
      `}</style>

      {/* GitHub Panel Modal */}
      {showGitHub && <GitHubPanel yaml={yaml} yamlFormat={yamlFormat} onClose={() => setShowGitHub(false)} />}

      {/* LEFT SIDEBAR */}
      {sidebarOpen && (
        <div style={{ width: "260px", minWidth: "260px", background: "#0a0f1e", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", zIndex: 10 }}>
          <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "#f1f5f9", fontFamily: "'Syne', sans-serif", letterSpacing: "-0.02em" }}>⚙️ PipeForge</div>
            <div style={{ fontSize: "10px", color: "#475569", marginTop: "2px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Visual CI/CD Builder</div>
          </div>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px", fontWeight: "600" }}>Quick Templates</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {Object.entries(TEMPLATES).map(([key, tpl]) => (
                <button key={key} onClick={() => loadTemplate(key)}
                  style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "5px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.target.style.background = "#334155"; e.target.style.color = "#f1f5f9"; }}
                  onMouseLeave={(e) => { e.target.style.background = "#1e293b"; e.target.style.color = "#94a3b8"; }}>
                  {tpl.emoji} {tpl.name}
                </button>
              ))}
              <button onClick={clearCanvas} style={{ background: "transparent", border: "1px solid #334155", color: "#ef4444", padding: "5px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace" }}>Clear</button>
            </div>
          </div>
          <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
            {BLOCK_CATEGORIES.map((cat, i) => (
              <button key={i} onClick={() => setActiveCategory(i)}
                style={{ flex: 1, padding: "8px 4px", background: activeCategory === i ? "#1e293b" : "transparent", border: "none", borderBottom: activeCategory === i ? "2px solid #6366f1" : "2px solid transparent", color: activeCategory === i ? "#f1f5f9" : "#475569", cursor: "pointer", fontSize: "14px", transition: "all 0.15s" }}
                title={cat.name}>{cat.icon}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px", fontWeight: "600" }}>{BLOCK_CATEGORIES[activeCategory].name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {BLOCK_CATEGORIES[activeCategory].blocks.map((block) => (
                <div key={block.blockType} className="block-item" draggable
                  onDragStart={(e) => e.dataTransfer.setData("application/reactflow", JSON.stringify(block))}
                  style={{ background: "#0f172a", border: `1px solid ${block.color}44`, "--color": block.color, borderRadius: "10px", padding: "10px 12px", cursor: "grab", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "18px" }}>{block.icon}</span>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#e2e8f0" }}>{block.label}</div>
                    <div style={{ fontSize: "9px", color: "#64748b", marginTop: "1px" }}>{block.description}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "16px", padding: "10px", background: "#0f172a", border: "1px dashed #1e293b", borderRadius: "8px", fontSize: "10px", color: "#334155", textAlign: "center", lineHeight: "1.6" }}>
              Drag blocks to canvas<br />Connect with arrows<br />YAML generates live
            </div>
          </div>
        </div>
      )}

      {/* MAIN CANVAS */}
      <div style={{ flex: 1, position: "relative" }} ref={reactFlowWrapper}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "52px", background: "#0a0f1e", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", padding: "0 16px", gap: "8px", zIndex: 10 }}>
          <button onClick={() => setSidebarOpen((s) => !s)} style={topBtnStyle}>☰</button>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: "10px", color: "#334155" }}>{nodes.length} blocks · {edges.length} connections</div>
          <button onClick={() => setShowYaml((s) => !s)} style={topBtnStyle}>{showYaml ? "Hide YAML" : "Show YAML"}</button>
          <button onClick={copyYaml} style={{ ...topBtnStyle, background: copied ? "#10b981" : "#1e293b", color: copied ? "#fff" : "#94a3b8", borderColor: copied ? "#10b981" : "#334155" }}>{copied ? "✓ Copied!" : "Copy YAML"}</button>
          <button onClick={downloadYaml} style={{ ...topBtnStyle, background: downloaded ? "#10b981" : "#3b82f6", color: "#fff", borderColor: downloaded ? "#10b981" : "#3b82f6" }}>{downloaded ? "✓ Saved!" : "⬇ Download"}</button>
          {/* NEW: Push to GitHub button */}
          <button onClick={() => setShowGitHub(true)} style={{ ...topBtnStyle, background: "#6366f1", color: "#fff", borderColor: "#6366f1", fontWeight: "700" }}>🐙 Push to GitHub</button>
        </div>

        <div style={{ position: "absolute", top: "52px", left: 0, right: 0, bottom: 0 }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick} onInit={setReactFlowInstance} onDrop={onDrop} onDragOver={onDragOver} nodeTypes={nodeTypes} fitView style={{ background: "#020617" }}>
            <Background color="#1e293b" gap={24} size={1} />
            <Controls />
            <Panel position="top-center">
              {nodes.length === 0 && (
                <div style={{ marginTop: "80px", textAlign: "center", fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", pointerEvents: "none", userSelect: "none" }}>
                  <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚙️</div>
                  <div style={{ color: "#334155", fontWeight: "600" }}>Drag blocks from the sidebar</div>
                  <div style={{ color: "#1e293b", marginTop: "4px", fontSize: "11px" }}>or load a template to get started</div>
                </div>
              )}
            </Panel>
          </ReactFlow>
          {selectedNode && <ConfigPanel node={selectedNode} onUpdate={(id, cfg) => { updateNodeConfig(id, cfg); setSelectedNode((n) => (n?.id === id ? { ...n, data: { ...n.data, config: cfg } } : n)); }} onClose={() => setSelectedNode(null)} />}
        </div>
      </div>

      {/* RIGHT YAML PANEL */}
      {showYaml && (
        <div style={{ width: "380px", minWidth: "380px", background: "#0a0f1e", borderLeft: "1px solid #1e293b", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#f1f5f9" }}>Generated YAML</div>
                <div style={{ fontSize: "9px", color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.08em" }}>{yamlFormat === "github" ? "GitHub Actions" : "GitLab CI"} · Live Preview</div>
              </div>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981", animation: "pulse 2s infinite" }} />
            </div>
            <div style={{ display: "flex", background: "#0f172a", borderRadius: "8px", padding: "3px", border: "1px solid #1e293b" }}>
              <button onClick={() => setYamlFormat("github")} style={{ flex: 1, padding: "6px", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", fontWeight: "600", transition: "all 0.15s", background: yamlFormat === "github" ? "#6366f1" : "transparent", color: yamlFormat === "github" ? "#fff" : "#475569" }}>GitHub Actions</button>
              <button onClick={() => setYamlFormat("gitlab")} style={{ flex: 1, padding: "6px", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", fontWeight: "600", transition: "all 0.15s", background: yamlFormat === "gitlab" ? "#e2432a" : "transparent", color: yamlFormat === "gitlab" ? "#fff" : "#475569" }}>GitLab CI</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            <pre style={{ margin: 0, fontSize: "11px", lineHeight: "1.7", color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre", overflowX: "auto" }}>
              {yaml.split("\n").map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "12px" }}>
                  <span style={{ color: "#1e293b", minWidth: "24px", textAlign: "right", userSelect: "none", fontSize: "10px" }}>{i + 1}</span>
                  <span style={{ color: colorizeYaml(line) }}>{line || " "}</span>
                </div>
              ))}
            </pre>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
            <div style={{ fontSize: "10px", color: "#334155", lineHeight: "1.6" }}>
              {yamlFormat === "github" ? <>Save as <span style={{ color: "#6366f1" }}>.github/workflows/ci.yml</span></> : <>Save as <span style={{ color: "#e2432a" }}>.gitlab-ci.yml</span></>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
