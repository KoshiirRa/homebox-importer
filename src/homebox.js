const trimTrailingSlash = value => value.replace(/\/+$/, "");

export class HomeboxClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error("HOMEBOX_URL is required");
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);

    const response = await this.fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const detail = typeof body === "object" ? JSON.stringify(body) : body;
      throw new Error(`HomeBox ${response.status}: ${detail || response.statusText}`);
    }
    return body;
  }

  status() {
    return this.request("/v1/status");
  }

  entityTypes() {
    return this.request("/v1/entity-types");
  }

  async entities({ page = 1, pageSize = 500 } = {}) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return this.request(`/v1/entities?${params}`);
  }

  async locations() {
    const tree = await this.request("/v1/entities/tree?withItems=false");
    const flatten = (nodes, ancestors = []) => nodes.flatMap(node => {
      const path = [...ancestors, node.name];
      return [
        { id: node.id, assetId: node.assetId || "", name: node.name, path: path.join(" → ") },
        ...flatten(node.children ?? [], path)
      ];
    });
    return flatten(Array.isArray(tree) ? tree : []);
  }

  async defaultItemTypeId() {
    const types = await this.entityTypes();
    const preferred = types.find(type => !type.isLocation && type.name.toLowerCase() === "item")
      ?? types.find(type => !type.isLocation);
    return preferred?.id ?? null;
  }

  async createBook({ title, authors = [], description = "", isbn, publisher = "", publishedDate = "", parentId, coverUrl = "" }) {
    return this.createInventoryItem({
      title,
      creators: authors,
      description,
      barcode: isbn,
      manufacturer: publisher,
      modelNumber: isbn,
      releaseDate: publishedDate,
      parentId,
      imageUrl: coverUrl,
      mediaType: "Book",
      identifierName: "ISBN"
    });
  }

  async createInventoryItem({ title, creators = [], description = "", barcode, manufacturer = "", modelNumber = "", releaseDate = "", parentId, imageUrl = "", mediaType = "Item", quantity = 1, identifierName = "Barcode" }) {
    const entityTypeId = await this.defaultItemTypeId();
    const resolvedQuantity = Math.max(1, Number.parseInt(quantity, 10) || 1);
    const created = await this.request("/v1/entities", {
      method: "POST",
      body: JSON.stringify({
        name: title,
        description: description.slice(0, 1000),
        parentId: parentId || null,
        quantity: resolvedQuantity,
        ...(entityTypeId ? { entityTypeId } : {})
      })
    });

    const notes = [
      creators.length ? `Creators: ${creators.join(", ")}` : "",
      releaseDate ? `Released: ${releaseDate}` : "",
      imageUrl ? `Image: ${imageUrl}` : "",
      "Imported by HomeBox Importer"
    ].filter(Boolean).join("\n");

    const update = {
      id: created.id,
      name: title,
      description: description.slice(0, 1000),
      parentId: parentId || null,
      quantity: resolvedQuantity,
      assetId: created.assetId || "",
      manufacturer,
      modelNumber: modelNumber || barcode,
      notes,
      serialNumber: barcode,
      tagIds: created.tags?.map(tag => tag.id) ?? [],
      fields: [
        { name: identifierName, type: "text", textValue: barcode },
        { name: "Creators", type: "text", textValue: creators.join(", ") },
        { name: "Media Type", type: "text", textValue: mediaType }
      ]
    };
    const resolvedTypeId = entityTypeId || created.entityType?.id;
    if (resolvedTypeId) update.entityTypeId = resolvedTypeId;

    return this.request(`/v1/entities/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(update)
    });
  }
}
