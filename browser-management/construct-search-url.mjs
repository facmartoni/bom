export function constructSearchUrl(
  city,
  searchTerm,
  daysSinceListed,
  minPrice,
  maxPrice
) {
  const searchTermEncoded = encodeURIComponent(searchTerm.trim());
  const cityEncoded = encodeURIComponent(city.trim());
  const daysSinceListedEncoded = encodeURIComponent(daysSinceListed.toString());

  let url = `https://www.facebook.com/marketplace/${cityEncoded}/search?daysSinceListed=${daysSinceListedEncoded}&query=${searchTermEncoded}&exact=false`;

  if (minPrice && maxPrice) {
    url += `&minPrice=${minPrice}&maxPrice=${maxPrice}`;
  } else if (minPrice) {
    url += `&minPrice=${minPrice}`;
  } else if (maxPrice) {
    url += `&maxPrice=${maxPrice}`;
  }

  return url;
}
