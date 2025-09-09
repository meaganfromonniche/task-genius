import {createReadStream, createWriteStream, readFileSync} from "fs";
import {rm} from "fs/promises";
import JSZip from "jszip";
import {join} from "path";
import {pipeline} from "stream/promises";
import {globby} from "globby"

const assets = ["main.js", "styles.css", "manifest.json"];

const isDryRun = process.env.RELEASE_IT_DRY_RUN === '1' || process.env.RELEASE_IT === '1';

if (isDryRun) {
	console.log("[dry-run] skip zipping dist artifacts");
	process.exit(0);
}

await globby("dist/*.zip").then(files => Promise.all(files.map(f => rm(f))))

const zip = new JSZip();
for (const filename of assets) {
	zip.file(filename, createReadStream(join("dist", filename)));
}
const version = JSON.parse(readFileSync(join("package.json"), "utf-8")).version;
const out = join("dist", `task-genius-${version}.zip`)
await pipeline(
	zip.generateNodeStream({type: "nodebuffer", streamFiles: true, compression: "DEFLATE"}),
	createWriteStream(out),
);
console.log(out + " written.");
