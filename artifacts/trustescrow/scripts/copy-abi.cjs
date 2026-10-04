const fs = require("node:fs");
const path = require("node:path");

const artifactPath = path.join(
  __dirname,
  "..",
  "build",
  "hardhat-artifacts",
  "contracts",
  "Escrow.sol",
  "Escrow.json",
);
const outputPath = path.join(__dirname, "..", "src", "lib", "escrow-abi.json");

if (!fs.existsSync(artifactPath)) {
  throw new Error("Compile the Escrow contract before generating the frontend ABI.");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
fs.writeFileSync(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
process.stdout.write(`Wrote frontend ABI: ${path.relative(process.cwd(), outputPath)}\n`);