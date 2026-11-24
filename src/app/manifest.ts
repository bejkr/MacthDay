import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Matchday",
    short_name: "Matchday",
    description: "Zápasy, dochádzka, štatistiky a pokladnica našej futbalovej partie.",
    lang: "sk",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0E0D",
    theme_color: "#0B0E0D",
    categories: ["sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Termíny", url: "/terminy" },
      { name: "Štatistiky", url: "/statistiky" },
    ],
  };
}
