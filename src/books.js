export function normalizeIsbn(value) {
  return String(value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
}

export function isValidIsbn(value) {
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

export async function lookupBook(isbnValue, fetchImpl = fetch) {
  const isbn = normalizeIsbn(isbnValue);
  if (!isValidIsbn(isbn)) throw new Error("Enter a valid ISBN-10 or ISBN-13");

  const googleUrl = new URL("https://www.googleapis.com/books/v1/volumes");
  googleUrl.searchParams.set("q", `isbn:${isbn}`);
  googleUrl.searchParams.set("maxResults", "5");
  const response = await fetchImpl(googleUrl);
  if (response.ok) {
    const data = await response.json();
    const matches = (data.items ?? []).map(item => {
      const info = item.volumeInfo ?? {};
      return {
        provider: "Google Books",
        providerId: item.id,
        isbn,
        title: info.title ?? "Untitled book",
        subtitle: info.subtitle ?? "",
        authors: info.authors ?? [],
        publisher: info.publisher ?? "",
        publishedDate: info.publishedDate ?? "",
        description: info.description ?? "",
        coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? ""
      };
    });
    if (matches.length) return matches;
  }

  const openLibraryUrl = new URL("https://openlibrary.org/search.json");
  openLibraryUrl.searchParams.set("isbn", isbn);
  openLibraryUrl.searchParams.set("fields", "key,title,author_name,publisher,first_publish_year,cover_i");
  openLibraryUrl.searchParams.set("limit", "5");
  const fallbackResponse = await fetchImpl(openLibraryUrl, {
    headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" }
  });
  if (!fallbackResponse.ok) throw new Error(`Book metadata providers unavailable (Open Library ${fallbackResponse.status})`);
  const fallbackData = await fallbackResponse.json();
  const fallbackMatches = (fallbackData.docs ?? []).map(book => ({
    provider: "Open Library",
    providerId: book.key ?? isbn,
    isbn,
    title: book.title ?? "Untitled book",
    subtitle: "",
    authors: book.author_name ?? [],
    publisher: book.publisher?.[0] ?? "",
    publishedDate: book.first_publish_year ? String(book.first_publish_year) : "",
    description: "",
    coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : ""
  }));
  if (!fallbackMatches.length) throw new Error(`No book metadata found for ISBN ${isbn}`);
  return fallbackMatches;
}
