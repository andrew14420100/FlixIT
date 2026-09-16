// Netflix-style illustrated profile avatars (ids match the legacy color ids stored in profileImage)
export const AVATARS = [
  { id: "red", label: "Mostro", src: "/avatars/red.webp", color: "#e50914" },
  { id: "blue", label: "Robot", src: "/avatars/blue.webp", color: "#0071eb" },
  { id: "green", label: "Alieno", src: "/avatars/green.webp", color: "#2bb535" },
  { id: "yellow", label: "Gatto", src: "/avatars/yellow.webp", color: "#f5c518" },
  { id: "purple", label: "Ninja", src: "/avatars/purple.webp", color: "#8b5cf6" },
  { id: "orange", label: "Volpe", src: "/avatars/orange.webp", color: "#f97316" },
  { id: "pink", label: "Panda", src: "/avatars/pink.webp", color: "#ec4899" },
  { id: "teal", label: "Astronauta", src: "/avatars/teal.webp", color: "#14b8a6" },
];

export const DEFAULT_AVATAR = "/avatars/default.webp";

export const avatarSrc = (profileImage?: string | null) =>
  AVATARS.find((a) => a.id === profileImage)?.src || DEFAULT_AVATAR;
