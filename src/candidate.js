export function isBookCandidate(item) {
  return item?.mediaType === "Book" || Boolean(item?.isbn);
}
