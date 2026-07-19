export function normalizeBarcode(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidGtin(value) {
  const barcode = normalizeBarcode(value);
  if (![8, 12, 13, 14].includes(barcode.length)) return false;
  const digits = [...barcode].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function classifyProduct(item) {
  const text = `${item.category ?? ""} ${item.title ?? ""}`.toLowerCase();
  if (/video game|gaming|playstation|xbox|nintendo|switch|game boy|wii/.test(text)) return "Video Game";
  if (/blu.?ray|dvd|movie|movies|film|video/.test(text)) return "Movie";
  if (/compact disc|audio cd|music|vinyl|record album|cassette/.test(text)) return "Music";
  return "Item";
}

export async function lookupMedia(barcodeValue, fetchImpl = fetch, { discogsToken = "", upcItemDbApiKey = "" } = {}) {
  const barcode = normalizeBarcode(barcodeValue);
  if (!isValidGtin(barcode)) throw new Error("Enter a valid UPC, EAN, or GTIN barcode");

  if (discogsToken) {
    const discogsUrl = new URL("https://api.discogs.com/database/search");
    discogsUrl.searchParams.set("barcode", barcode);
    discogsUrl.searchParams.set("type", "release");
    discogsUrl.searchParams.set("per_page", "5");
    const discogsResponse = await fetchImpl(discogsUrl, {
      headers: {
        Authorization: `Discogs token=${discogsToken.replace(/^Discogs\s+token=/i, "")}`,
        "User-Agent": "HomeBoxImporter/0.1 +https://github.com/KoshiirRa/homebox-importer"
      }
    });
    if (discogsResponse.ok) {
      const data = await discogsResponse.json();
      const matches = (data.results ?? []).map(release => {
        const [creditedArtist, ...titleParts] = String(release.title ?? "").split(" - ");
        return {
          provider: "Discogs",
          providerId: String(release.id),
          barcode,
          title: titleParts.length ? titleParts.join(" - ") : creditedArtist || "Untitled release",
          mediaType: "Music",
          creators: titleParts.length ? [creditedArtist] : [],
          manufacturer: release.label?.[0] ?? "",
          modelNumber: release.catno ?? "",
          releaseDate: release.year ? String(release.year) : "",
          description: (release.format ?? []).join(", "),
          imageUrl: release.cover_image ?? release.thumb ?? "",
          quantity: 1
        };
      });
      if (matches.length) return matches;
    } else {
      throw new Error(`Discogs lookup failed (${discogsResponse.status})`);
    }
  }

  const musicBrainzUrl = new URL("https://musicbrainz.org/ws/2/release/");
  musicBrainzUrl.searchParams.set("query", `barcode:${barcode}`);
  musicBrainzUrl.searchParams.set("fmt", "json");
  musicBrainzUrl.searchParams.set("limit", "5");
  const musicResponse = await fetchImpl(musicBrainzUrl, {
    headers: { "User-Agent": "HomeBox-Importer/0.1 (+https://github.com/KoshiirRa/homebox-importer)" }
  });
  if (musicResponse.ok) {
    const data = await musicResponse.json();
    const matches = (data.releases ?? []).map(release => ({
      provider: "MusicBrainz",
      providerId: release.id,
      barcode,
      title: release.title || "Untitled release",
      mediaType: "Music",
      creators: (release["artist-credit"] ?? []).map(credit => credit.name).filter(Boolean),
      manufacturer: release["label-info"]?.[0]?.label?.name ?? "",
      modelNumber: release["label-info"]?.[0]?.["catalog-number"] ?? "",
      releaseDate: release.date ?? "",
      description: (release.media ?? []).map(medium => medium.format).filter(Boolean).join(", "),
      imageUrl: `https://coverartarchive.org/release/${release.id}/front-250`,
      quantity: 1
    }));
    if (matches.length) return matches;
  }

  const upcUrl = new URL(upcItemDbApiKey
    ? "https://api.upcitemdb.com/prod/v1/lookup"
    : "https://api.upcitemdb.com/prod/trial/lookup");
  upcUrl.searchParams.set("upc", barcode);
  const headers = { "User-Agent": "HomeBox-Importer/0.1 (+https://github.com/KoshiirRa/homebox-importer)" };
  if (upcItemDbApiKey) {
    headers.user_key = upcItemDbApiKey;
    headers.key_type = "3scale";
  }
  const upcResponse = await fetchImpl(upcUrl, { headers });
  if (upcResponse.ok) {
    const data = await upcResponse.json();
    const matches = (data.items ?? []).map(item => ({
      provider: "UPCitemdb",
      providerId: item.ean || item.upc || barcode,
      barcode,
      title: item.title || "Untitled item",
      mediaType: classifyProduct(item),
      creators: [],
      manufacturer: item.brand ?? "",
      modelNumber: item.model ?? "",
      releaseDate: "",
      description: item.description ?? "",
      imageUrl: item.images?.[0] ?? "",
      quantity: 1
    }));
    if (matches.length) return matches;
  } else if (![400, 404].includes(upcResponse.status)) {
    throw new Error(`UPCitemdb lookup failed (${upcResponse.status})`);
  }

  throw new Error(`No product metadata found for barcode ${barcode}`);
}
