const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const STOP_WORDS = new Set(["a", "an", "and", "book", "edition", "for", "game", "of", "roleplaying", "the"]);

function normalizeIsbn(value) {
  return String(value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 10) {
    const sum = [...isbn].reduce((total, character, index) => {
      const number = character === "X" && index === 9 ? 10 : Number(character);
      return total + number * (10 - index);
    }, 0);
    return Number.isFinite(sum) && sum % 11 === 0;
  }
  if (isbn.length === 13 && /^\d+$/.test(isbn)) {
    const sum = [...isbn].reduce((total, character, index) => total + Number(character) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  return false;
}

function words(value) {
  return new Set(String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 2 && !STOP_WORDS.has(word)));
}

export function titleSimilarity(query, title) {
  const expected = words(query);
  if (!expected.size) return 0;
  const candidate = words(title);
  let overlap = 0;
  for (const word of expected) if (candidate.has(word)) overlap += 1;
  return overlap / expected.size;
}

function containsIsbn(value, isbn) {
  const digits = String(value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
  return digits.includes(isbn);
}

function cleanTitle(value, isbn) {
  let title = String(value ?? "");
  if (isbn) title = title.replace(new RegExp(isbn.split("").join("[^0-9]*"), "g"), "");
  title = title.split(/\s+\|\s+/)[0].trim().replace(/[\s:–—|-]+$/, "");
  return title || "Untitled book";
}

function braveMatch(result, isbn) {
  const evidence = [result.title, result.description, result.url].some(value => containsIsbn(value, isbn));
  return {
    provider: "Brave Search",
    providerId: result.url,
    isbn: evidence ? isbn : "",
    title: cleanTitle(result.title, isbn),
    subtitle: "",
    authors: [],
    publisher: result.profile?.long_name ?? "",
    publishedDate: "",
    description: result.description ?? "",
    coverUrl: result.thumbnail?.original ?? result.thumbnail?.src ?? "",
    sourceUrl: result.url ?? ""
  };
}

async function request(fetchImpl, apiKey, query) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");
  url.searchParams.set("country", "us");
  url.searchParams.set("search_lang", "en");
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey
      }
    });
    if (!response?.ok) return [];
    const data = await response.json();
    return data.web?.results ?? [];
  } catch {
    return [];
  }
}

export async function searchBraveBooks({ isbn: isbnValue = "", text = "" }, fetchImpl = fetch, { apiKey = "" } = {}) {
  if (!apiKey) return [];
  const isbn = normalizeIsbn(isbnValue);
  if (isValidIsbn(isbn)) {
    const exact = (await request(fetchImpl, apiKey, `"${isbn}"`))
      .map(result => braveMatch(result, isbn))
      .filter(book => book.isbn === isbn);
    if (exact.length) return exact;
  }

  const query = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!query) return [];
  return (await request(fetchImpl, apiKey, `"${query}"`))
    .filter(result => titleSimilarity(query, result.title) >= 0.7)
    .map(result => braveMatch(result, isbn));
}
