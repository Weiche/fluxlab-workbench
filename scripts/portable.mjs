import fs from "node:fs";
let html = fs.readFileSync("dist/index.html", "utf8");
html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/,
  (_, url) =>
    '<script type="module">' +
    fs
      .readFileSync("dist/" + url, "utf8")
      .replace(/<\/script/gi, "<\\/script") +
    "</script>",
);
html = html.replace(
  /<link rel="stylesheet" crossorigin href="([^"]+)">/,
  (_, url) => "<style>" + fs.readFileSync("dist/" + url, "utf8") + "</style>",
);
const logo =
  "data:image/svg+xml;base64," +
  fs.readFileSync("public/flux.svg").toString("base64");
html = html.replaceAll("./flux.svg", logo);
fs.mkdirSync("release", { recursive: true });
fs.writeFileSync("release/FluxLab-Offline.html", html);
