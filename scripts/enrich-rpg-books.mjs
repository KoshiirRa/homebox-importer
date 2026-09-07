#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { lookupBook } from "../src/books.js";
import { HomeboxClient } from "../src/homebox.js";
import { applyApprovedReport, enrichRpgBooks } from "../src/rpg-enrichment.js";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
if (args.has("--dry-run") && write) throw new Error("Choose either --dry-run or --write");
const applyReportArgument = process.argv.slice(2).find(argument => argument.startsWith("--apply-report="));
const applyReportPath = applyReportArgument?.slice("--apply-report=".length);
if (applyReportPath && !write) throw new Error("--apply-report requires --write");

const homebox = new HomeboxClient({
  baseUrl: process.env.HOMEBOX_URL ?? "http://homebox:7745",
  apiKey: process.env.HOMEBOX_API_KEY
});
const concurrency = Math.max(1, Math.min(10, Number.parseInt(process.env.RPG_ENRICH_CONCURRENCY ?? "4", 10) || 4));
const lookupIsbn = isbn => lookupBook(isbn, fetch, {
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY,
  hardcoverApiToken: process.env.HARDCOVER_API_TOKEN,
  isbnDbApiKey: process.env.ISBNDB_API_KEY,
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY
});

const report = applyReportPath
  ? await applyApprovedReport({ homebox, report: JSON.parse(await readFile(applyReportPath, "utf8")), concurrency })
  : await enrichRpgBooks({ homebox, lookupIsbn, write, concurrency });
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
