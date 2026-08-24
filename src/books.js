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

function bookDisplayTitle(book) {
  return [book.title, book.subtitle].filter(Boolean).join(": ");
}

function metadataScore(book) {
  const displayTitle = bookDisplayTitle(book);
  return displayTitle.length
    + (book.subtitle ? 30 : 0)
    + Math.min(book.description?.length ?? 0, 300) / 20
    + (book.authors?.length ? 5 : 0)
    + (book.coverUrl ? 3 : 0);
}

async function fetchProvider(fetchImpl, ...args) {
  try {
    return await fetchImpl(...args);
  } catch {
    return null;
  }
}

async function readJson(response) {
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function lookupBook(isbnValue, fetchImpl = fetch, { hardcoverApiToken = "", isbnDbApiKey = "" } = {}) {
  const isbn = normalizeIsbn(isbnValue);
  if (!isValidIsbn(isbn)) throw new Error("Enter a valid ISBN-10 or ISBN-13");
  const matches = [];

  const googleUrl = new URL("https://www.googleapis.com/books/v1/volumes");
  googleUrl.searchParams.set("q", `isbn:${isbn}`);
  googleUrl.searchParams.set("maxResults", "5");
  const response = await fetchProvider(fetchImpl, googleUrl);
  const data = await readJson(response);
  if (data) {
    matches.push(...(data.items ?? []).map(item => {
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
    }));
  }

  const openLibraryBooksUrl = new URL("https://openlibrary.org/api/books");
  openLibraryBooksUrl.searchParams.set("bibkeys", `ISBN:${isbn}`);
  openLibraryBooksUrl.searchParams.set("jscmd", "data");
  openLibraryBooksUrl.searchParams.set("format", "json");
  const exactBookResponse = await fetchProvider(fetchImpl, openLibraryBooksUrl, {
    headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" }
  });
  const exactBookData = await readJson(exactBookResponse) ?? {};
  const exactBook = exactBookData[`ISBN:${isbn}`];
  if (exactBook) {
    matches.push({
      provider: "Open Library",
      providerId: exactBook.key ?? isbn,
      isbn,
      title: exactBook.title ?? "Untitled book",
      subtitle: exactBook.subtitle ?? "",
      authors: (exactBook.authors ?? []).map(author => author.name).filter(Boolean),
      publisher: exactBook.publishers?.[0]?.name ?? "",
      publishedDate: exactBook.publish_date ?? "",
      description: "",
      coverUrl: exactBook.cover?.medium?.replace(/^http:/, "https:") ?? ""
    });
  } else {
    const openLibraryUrl = new URL("https://openlibrary.org/search.json");
    openLibraryUrl.searchParams.set("isbn", isbn);
    openLibraryUrl.searchParams.set("fields", "key,title,subtitle,author_name,publisher,first_publish_year,cover_i,edition_key");
    openLibraryUrl.searchParams.set("limit", "5");
    const fallbackResponse = await fetchProvider(fetchImpl, openLibraryUrl, {
      headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" }
    });
    const fallbackData = await readJson(fallbackResponse);
    if (fallbackData) {
      let edition = null;
      if (fallbackData.docs?.length) {
        const editionResponse = await fetchProvider(fetchImpl, `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`, {
          headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" }
        });
        edition = await readJson(editionResponse);
      }
      matches.push(...(fallbackData.docs ?? []).map((book, index) => ({
        provider: "Open Library",
        providerId: index === 0 && edition?.key ? edition.key : book.key ?? isbn,
        isbn,
        title: index === 0 ? edition?.title || book.title || "Untitled book" : book.title ?? "Untitled book",
        subtitle: index === 0 ? edition?.subtitle || book.subtitle || "" : book.subtitle ?? "",
        authors: book.author_name ?? [],
        publisher: index === 0 ? edition?.publishers?.[0] || book.publisher?.[0] || "" : book.publisher?.[0] ?? "",
        publishedDate: index === 0 ? edition?.publish_date || (book.first_publish_year ? String(book.first_publish_year) : "") : book.first_publish_year ? String(book.first_publish_year) : "",
        description: "",
        coverUrl: index === 0 && edition?.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-M.jpg`
          : book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : ""
      })));
    }
  }

  if (hardcoverApiToken) {
    const hardcoverResponse = await fetchProvider(fetchImpl, "https://api.hardcover.app/v1/graphql", {
      method: "POST",
      headers: {
        authorization: /^Bearer\s/i.test(hardcoverApiToken) ? hardcoverApiToken : `Bearer ${hardcoverApiToken}`,
        "content-type": "application/json",
        "user-agent": "HomeBox-Importer/0.1 (+https://github.com/KoshiirRa/homebox-importer)"
      },
      body: JSON.stringify({
        query: `query BookByIsbn($isbn: String!) {
          editions(where: {_or: [{isbn_10: {_eq: $isbn}}, {isbn_13: {_eq: $isbn}}]}, limit: 5) {
            id title subtitle release_date isbn_10 isbn_13
            image { url }
            publisher { name }
            book {
              title subtitle description release_date
              contributions { author { name } }
            }
          }
        }`,
        variables: { isbn }
      })
    });
    const hardcoverData = await readJson(hardcoverResponse);
    if (hardcoverData && !hardcoverData.errors?.length) {
      const hardcoverMatches = (hardcoverData.data?.editions ?? []).map(edition => ({
        provider: "Hardcover",
        providerId: String(edition.id),
        isbn,
        title: edition.title || edition.book?.title || "Untitled book",
        subtitle: edition.subtitle || edition.book?.subtitle || "",
        authors: (edition.book?.contributions ?? []).map(contribution => contribution.author?.name).filter(Boolean),
        publisher: edition.publisher?.name ?? "",
        publishedDate: edition.release_date || edition.book?.release_date || "",
        description: edition.book?.description ?? "",
        coverUrl: edition.image?.url ?? ""
      }));
      matches.push(...hardcoverMatches);
    }
  }

  if (isbnDbApiKey) {
    const isbnDbResponse = await fetchProvider(fetchImpl, `https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`, {
      headers: {
        Authorization: isbnDbApiKey,
        "User-Agent": "HomeBox-Importer/0.1 (+https://github.com/KoshiirRa/homebox-importer)"
      }
    });
    const isbnDbData = await readJson(isbnDbResponse);
    if (isbnDbData) {
      const { book } = isbnDbData;
      if (book?.title) {
        matches.push({
          provider: "ISBNdb",
          providerId: book.isbn13 || book.isbn || isbn,
          isbn,
          title: book.title,
          subtitle: "",
          authors: book.authors ?? [],
          publisher: book.publisher ?? "",
          publishedDate: book.date_published ?? "",
          description: book.synopsys || book.overview || book.excerpt || "",
          coverUrl: book.image ?? ""
        });
      }
    }
  }

  if (!matches.length) throw new Error(`No book metadata found for ISBN ${isbn}`);
  const uniqueMatches = [...new Map(matches.map(book => [
    bookDisplayTitle(book).trim().toLocaleLowerCase(),
    book
  ])).values()];
  return uniqueMatches.sort((left, right) => metadataScore(right) - metadataScore(left));
}
