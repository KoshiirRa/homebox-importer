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
        { id: node.id, name: node.name, path: path.join(" → ") },
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
    const entityTypeId = await this.defaultItemTypeId();
    const created = await this.request("/v1/entities", {
      method: "POST",
      body: JSON.stringify({
        name: title,
        description: description.slice(0, 1000),
        parentId: parentId || null,
        quantity: 1,
        ...(entityTypeId ? { entityTypeId } : {})
      })
    });

    const notes = [
      authors.length ? `Authors: ${authors.join(", ")}` : "",
      publishedDate ? `Published: ${publishedDate}` : "",
      coverUrl ? `Cover: ${coverUrl}` : "",
      "Imported by HomeBox Importer"
    ].filter(Boolean).join("\n");

    const update = {
      id: created.id,
      name: title,
      description: description.slice(0, 1000),
      parentId: parentId || null,
      quantity: 1,
      assetId: created.assetId || "",
      manufacturer: publisher,
      modelNumber: isbn,
      notes,
      serialNumber: isbn,
      tagIds: created.tags?.map(tag => tag.id) ?? [],
      fields: [
        { name: "ISBN", type: "text", textValue: isbn },
        { name: "Authors", type: "text", textValue: authors.join(", ") },
        { name: "Media Type", type: "text", textValue: "Book" }
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
