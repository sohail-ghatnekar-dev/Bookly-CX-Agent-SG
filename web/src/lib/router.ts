// Hash routes, e.g. #/build/aops/returns or #/preview?aop=returns&v=5. No router library needed for a handful of pages.
import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { path: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function go(hash: string) {
  window.location.hash = hash;
  window.scrollTo({ top: 0 });
}
