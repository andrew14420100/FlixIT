// @ts-nocheck
/**
 * Mapping tra TMDB ID e CDN Image ID
 * CDN Base URL: https://cdn.streamingcommunityz.ninja/images/
 * 
 * Struttura:
 * - poster e backdrop sono IDENTICI (UUID del poster)
 * - detail_backdrop è l'UUID dalla pagina dettaglio (min-width: 800px)
 */

export const CDN_BASE_URL = "https://cdn.streamingcommunityz.ninja/images/";

export interface CDNImageMapping {
  poster: string;
  backdrop: string;
  detail_backdrop: string;
}

export const cdnImageMapping: Record<number, CDNImageMapping> = {
  // L'ultima missione: Project Hail Mary (TMDB: 687163)
  687163: {
    poster: "",
    backdrop: "42598b2d-a264-49ac-9847-fa14119ed8c4",
    detail_backdrop: "f9b72258-4868-42b4-801a-0a62ad46dc58"
  },

  // Peaky Blinders (TMDB: 60574)
  60574: {
    poster: "c9299944-1ca7-4b35-98b3-b7c0a50090d9",
    backdrop: "c9299944-1ca7-4b35-98b3-b7c0a50090d9",
    detail_backdrop: "2e3b58e6-5d5e-4204-89a4-7ad4ae5093e5"
  },

  // Stranger Things (TMDB: 66732)
  66732: {
    poster: "3b2332f8-be26-42e8-8549-ede1a3341591",
    backdrop: "3b2332f8-be26-42e8-8549-ede1a3341591",
    detail_backdrop: "3b2332f8-be26-42e8-8549-ede1a3341591"
  },

  // ONE PIECE Live Action (TMDB: 111110)
  111110: {
    poster: "b0f45b4d-d7b7-4e0f-8422-8bc8916859fb",
    backdrop: "b0f45b4d-d7b7-4e0f-8422-8bc8916859fb",
    detail_backdrop: "006ea20a-25ff-45e2-ac06-df575322b9f1"
  },

  // Bridgerton (TMDB: 91239)
  91239: {
    poster: "37593303-ccc2-46fc-8788-e9b767056870",
    backdrop: "37593303-ccc2-46fc-8788-e9b767056870",
    detail_backdrop: "4336c145-dca9-4cf5-8162-cc30f0d6d25b"
  },

  // Grey's Anatomy (TMDB: 1416)
  1416: {
    poster: "5ea15f2a-596c-49df-a965-5810c0353bcf",
    backdrop: "5ea15f2a-596c-49df-a965-5810c0353bcf",
    detail_backdrop: "e9f76f50-0920-4f46-a650-22e8c04a4d02"
  },

  // The Vampire Diaries (TMDB: 18165)
  18165: {
    poster: "57d5b196-f832-4a5a-be75-ebca92382dd3",
    backdrop: "57d5b196-f832-4a5a-be75-ebca92382dd3",
    detail_backdrop: "5a019071-93cf-4089-8408-ee822f85b955"
  },

  // Virgin River (TMDB: 88592)
  88592: {
    poster: "17d65393-0ecb-4370-be40-600764512402",
    backdrop: "17d65393-0ecb-4370-be40-600764512402",
    detail_backdrop: "17d65393-0ecb-4370-be40-600764512402"
  },

  // Outlander (TMDB: 56570)
  56570: {
    poster: "5909a49e-edb0-4067-8508-d83c755ae19c",
    backdrop: "5909a49e-edb0-4067-8508-d83c755ae19c",
    detail_backdrop: "5909a49e-edb0-4067-8508-d83c755ae19c"
  },

  // Formula 1: Drive to Survive (TMDB: 87083)
  87083: {
    poster: "52d003fd-fe65-4981-bbdb-e91e249a8148",
    backdrop: "52d003fd-fe65-4981-bbdb-e91e249a8148",
    detail_backdrop: "52d003fd-fe65-4981-bbdb-e91e249a8148"
  },

  // Monarch: Legacy of Monsters (TMDB: 202411)
  202411: {
    poster: "a71186a7-c13b-4547-98a0-59d55f0d2e22",
    backdrop: "a71186a7-c13b-4547-98a0-59d55f0d2e22",
    detail_backdrop: "a71186a7-c13b-4547-98a0-59d55f0d2e22"
  },

  // American Dad! (TMDB: 1433)
  1433: {
    poster: "a93db0ae-875a-427d-8b1d-d219d7095e6e",
    backdrop: "a93db0ae-875a-427d-8b1d-d219d7095e6e",
    detail_backdrop: "a93db0ae-875a-427d-8b1d-d219d7095e6e"
  },

  // The Night Agent (TMDB: 127532)
  127532: {
    poster: "064ad0a5-9137-4048-8146-f2f593e93a61",
    backdrop: "064ad0a5-9137-4048-8146-f2f593e93a61",
    detail_backdrop: "064ad0a5-9137-4048-8146-f2f593e93a61"
  },

  // Heated Rivalry (TMDB: 1126166)
  1126166: {
    poster: "7e112935-3ea1-487c-9ffc-81ffdb54c773",
    backdrop: "7e112935-3ea1-487c-9ffc-81ffdb54c773",
    detail_backdrop: "fc2daf8f-b5ec-4e97-b916-7c5c381dd3c6"
  },

  // A Knight of the Seven Kingdoms (TMDB: 237908)
  237908: {
    poster: "abd2001c-48be-4d20-b9d6-789adba4c919",
    backdrop: "abd2001c-48be-4d20-b9d6-789adba4c919",
    detail_backdrop: "abd2001c-48be-4d20-b9d6-789adba4c919"
  },

  // Emily in Paris (TMDB: 100698)
  100698: {
    poster: "2b117483-5c98-47b2-bcf5-6e1632fb0fb0",
    backdrop: "2b117483-5c98-47b2-bcf5-6e1632fb0fb0",
    detail_backdrop: "2b117483-5c98-47b2-bcf5-6e1632fb0fb0"
  },

  // Fallout (TMDB: 106379)
  106379: {
    poster: "88cd0a82-d28a-494c-b56c-f4cc93678f9b",
    backdrop: "88cd0a82-d28a-494c-b56c-f4cc93678f9b",
    detail_backdrop: "88cd0a82-d28a-494c-b56c-f4cc93678f9b"
  },

  // Shrinking (TMDB: 136311)
  136311: {
    poster: "c26ce0aa-7447-4f94-ba5e-8e534e8e0ec4",
    backdrop: "c26ce0aa-7447-4f94-ba5e-8e534e8e0ec4",
    detail_backdrop: "c26ce0aa-7447-4f94-ba5e-8e534e8e0ec4"
  },

  // Tell Me Lies (TMDB: 134549)
  134549: {
    poster: "7ffb319d-ee02-4053-9efa-14056724120a",
    backdrop: "7ffb319d-ee02-4053-9efa-14056724120a",
    detail_backdrop: "7ffb319d-ee02-4053-9efa-14056724120a"
  },

  // The Night Manager (TMDB: 63178)
  63178: {
    poster: "803cd89a-5db0-4052-95d6-2d409a76fa18",
    backdrop: "803cd89a-5db0-4052-95d6-2d409a76fa18",
    detail_backdrop: "803cd89a-5db0-4052-95d6-2d409a76fa18"
  },

  // The Pitt (TMDB: 249522)
  249522: {
    poster: "2c80ccbb-fc43-4de5-905c-58bd30d8a7ca",
    backdrop: "2c80ccbb-fc43-4de5-905c-58bd30d8a7ca",
    detail_backdrop: "2c80ccbb-fc43-4de5-905c-58bd30d8a7ca"
  },

  // Beast Games (TMDB: 259889)
  259889: {
    poster: "d55d4eda-a0d7-4a08-b554-312a97e00ac2",
    backdrop: "d55d4eda-a0d7-4a08-b554-312a97e00ac2",
    detail_backdrop: "d55d4eda-a0d7-4a08-b554-312a97e00ac2"
  },

  // Percy Jackson and the Olympians (TMDB: 136394)
  136394: {
    poster: "af771a94-3e21-49ed-8c5d-891474700e99",
    backdrop: "af771a94-3e21-49ed-8c5d-891474700e99",
    detail_backdrop: "af771a94-3e21-49ed-8c5d-891474700e99"
  },

  // Breaking Bad (TMDB: 1396)
  1396: {
    poster: "964c4cc1-e924-48fe-8d29-3ae3ccf1cf74",
    backdrop: "964c4cc1-e924-48fe-8d29-3ae3ccf1cf74",
    detail_backdrop: "964c4cc1-e924-48fe-8d29-3ae3ccf1cf74"
  },

  // Vikings (TMDB: 44217)
  44217: {
    poster: "e076d366-4f3b-4d6b-ab85-854d73f48605",
    backdrop: "e076d366-4f3b-4d6b-ab85-854d73f48605",
    detail_backdrop: "e076d366-4f3b-4d6b-ab85-854d73f48605"
  },

  // Lucifer (TMDB: 63174)
  63174: {
    poster: "4e0f17ec-39f4-4b1c-8e60-a75826aec287",
    backdrop: "4e0f17ec-39f4-4b1c-8e60-a75826aec287",
    detail_backdrop: "4e0f17ec-39f4-4b1c-8e60-a75826aec287"
  },

  // Hijack (TMDB: 194803)
  194803: {
    poster: "d48c37a8-3429-4c31-aee7-b8b78ce0b60f",
    backdrop: "d48c37a8-3429-4c31-aee7-b8b78ce0b60f",
    detail_backdrop: "d48c37a8-3429-4c31-aee7-b8b78ce0b60f"
  },

  // The Fall of the House of Usher (TMDB: 157065)
  157065: {
    poster: "d627faf4-e1f2-4e00-a2ad-a5770e60d989",
    backdrop: "d627faf4-e1f2-4e00-a2ad-a5770e60d989",
    detail_backdrop: "d627faf4-e1f2-4e00-a2ad-a5770e60d989"
  },

  // Maid (TMDB: 133352)
  133352: {
    poster: "9e400fd4-76ed-44f0-91d2-4c10a3885cd2",
    backdrop: "9e400fd4-76ed-44f0-91d2-4c10a3885cd2",
    detail_backdrop: "9e400fd4-76ed-44f0-91d2-4c10a3885cd2"
  },

  // Gilmore Girls (TMDB: 1399)
  1399: {
    poster: "145b660b-24f8-4f7f-8716-2fa49742977a",
    backdrop: "145b660b-24f8-4f7f-8716-2fa49742977a",
    detail_backdrop: "145b660b-24f8-4f7f-8716-2fa49742977a"
  },

  // ER (TMDB: 4589)
  4589: {
    poster: "bf75d1cd-32a3-4019-b50c-5b4ff9c7266f",
    backdrop: "bf75d1cd-32a3-4019-b50c-5b4ff9c7266f",
    detail_backdrop: "bf75d1cd-32a3-4019-b50c-5b4ff9c7266f"
  },

  // Cold Case (TMDB: 4565)
  4565: {
    poster: "91f57317-e060-4606-a45d-f919bf8188e7",
    backdrop: "91f57317-e060-4606-a45d-f919bf8188e7",
    detail_backdrop: "91f57317-e060-4606-a45d-f919bf8188e7"
  },

  // Scrubs (TMDB: 4556)
  4556: {
    poster: "2b1dc298-6965-4e5b-9f48-3adec6c190dd",
    backdrop: "2b1dc298-6965-4e5b-9f48-3adec6c190dd",
    detail_backdrop: "2b1dc298-6965-4e5b-9f48-3adec6c190dd"
  },

  // Gravity (TMDB: 49047)
  49047: {
    poster: "127b9b3c-d3b8-457f-b82f-584a2197f70e",
    backdrop: "127b9b3c-d3b8-457f-b82f-584a2197f70e",
    detail_backdrop: "127b9b3c-d3b8-457f-b82f-584a2197f70e"
  },

  // Hunger Games (TMDB: 70160)
  70160: {
    poster: "558ba009-7829-4ae2-bf41-82339f58ab02",
    backdrop: "558ba009-7829-4ae2-bf41-82339f58ab02",
    detail_backdrop: "558ba009-7829-4ae2-bf41-82339f58ab02"
  },

  // Sonic the Hedgehog (TMDB: 454626)
  454626: {
    poster: "31912501-c830-44ca-a50b-f84daafcf6e1",
    backdrop: "31912501-c830-44ca-a50b-f84daafcf6e1",
    detail_backdrop: "31912501-c830-44ca-a50b-f84daafcf6e1"
  },

  // Climax (TMDB: 476930)
  476930: {
    poster: "633b2c22-adbb-4ee6-823c-8ea7aa00abea",
    backdrop: "633b2c22-adbb-4ee6-823c-8ea7aa00abea",
    detail_backdrop: "633b2c22-adbb-4ee6-823c-8ea7aa00abea"
  },

  // The Lord of the Rings animated (TMDB: 123)
  123: {
    poster: "7778ba5f-1bd4-45a7-94fd-aa165f87b237",
    backdrop: "7778ba5f-1bd4-45a7-94fd-aa165f87b237",
    detail_backdrop: "7778ba5f-1bd4-45a7-94fd-aa165f87b237"
  },

  // Gandhi (TMDB: 11576)
  11576: {
    poster: "77d4c59a-556c-41d9-aac2-c87a6cf41c16",
    backdrop: "77d4c59a-556c-41d9-aac2-c87a6cf41c16",
    detail_backdrop: "77d4c59a-556c-41d9-aac2-c87a6cf41c16"
  },

  // Grand Prix (TMDB: 21048)
  21048: {
    poster: "c4f56464-a782-44bb-914c-f5e71968d310",
    backdrop: "c4f56464-a782-44bb-914c-f5e71968d310",
    detail_backdrop: "c4f56464-a782-44bb-914c-f5e71968d310"
  },

  // The Commitments (TMDB: 11889)
  11889: {
    poster: "ed9d1b4b-5d04-4c64-a4c9-ec81b9ae97f4",
    backdrop: "ed9d1b4b-5d04-4c64-a4c9-ec81b9ae97f4",
    detail_backdrop: "ed9d1b4b-5d04-4c64-a4c9-ec81b9ae97f4"
  },

  // The Conversation (TMDB: 592)
  592: {
    poster: "474159a3-d3a3-42de-a790-859f8bd0fa0c",
    backdrop: "474159a3-d3a3-42de-a790-859f8bd0fa0c",
    detail_backdrop: "474159a3-d3a3-42de-a790-859f8bd0fa0c"
  },

  // Band of Outsiders (TMDB: 335)
  335: {
    poster: "d5990da8-58f8-470a-a5b2-fe76c8d4b9ba",
    backdrop: "d5990da8-58f8-470a-a5b2-fe76c8d4b9ba",
    detail_backdrop: "d5990da8-58f8-470a-a5b2-fe76c8d4b9ba"
  },

  // Train de vie (TMDB: 10893)
  10893: {
    poster: "1fa2254c-7811-4b94-9532-53f6e52723fc",
    backdrop: "1fa2254c-7811-4b94-9532-53f6e52723fc",
    detail_backdrop: "1fa2254c-7811-4b94-9532-53f6e52723fc"
  },

  // Sleeping with the Enemy (TMDB: 1662)
  1662: {
    poster: "7eea1197-c26e-49f6-b580-7c9c9edbf394",
    backdrop: "7eea1197-c26e-49f6-b580-7c9c9edbf394",
    detail_backdrop: "7eea1197-c26e-49f6-b580-7c9c9edbf394"
  },

  // Miracolo a Milano (TMDB: 15472)
  15472: {
    poster: "5020aa90-4683-445c-97e3-4ce7654926e4",
    backdrop: "5020aa90-4683-445c-97e3-4ce7654926e4",
    detail_backdrop: "5020aa90-4683-445c-97e3-4ce7654926e4"
  },

  // Hollywood Party (TMDB: 11950)
  11950: {
    poster: "c92e1147-d2f5-4339-8ea3-c40d4c4ece08",
    backdrop: "c92e1147-d2f5-4339-8ea3-c40d4c4ece08",
    detail_backdrop: "c92e1147-d2f5-4339-8ea3-c40d4c4ece08"
  },

  // Naked Gun (TMDB: 37136)
  37136: {
    poster: "ee5a4122-d455-43b4-8948-a0b9cbf16f11",
    backdrop: "ee5a4122-d455-43b4-8948-a0b9cbf16f11",
    detail_backdrop: "ee5a4122-d455-43b4-8948-a0b9cbf16f11"
  },

  // Europa Europa (TMDB: 8276)
  8276: {
    poster: "906709ad-c497-4817-8272-513d7785fd98",
    backdrop: "906709ad-c497-4817-8272-513d7785fd98",
    detail_backdrop: "906709ad-c497-4817-8272-513d7785fd98"
  },

  // Sense and Sensibility (TMDB: 4584)
  4584: {
    poster: "bec02b68-1102-4fb3-8286-df7c68263a1b",
    backdrop: "bec02b68-1102-4fb3-8286-df7c68263a1b",
    detail_backdrop: "bec02b68-1102-4fb3-8286-df7c68263a1b"
  },

  // Lucky Luke (TMDB: 76120)
  76120: {
    poster: "c2fa3052-12a4-45c7-b59f-0e9e862adcc9",
    backdrop: "c2fa3052-12a4-45c7-b59f-0e9e862adcc9",
    detail_backdrop: "c2fa3052-12a4-45c7-b59f-0e9e862adcc9"
  },

    // Send Help (TMDB: 1198994)
  1198994: {
    poster: "3354f3c9-5337-479f-a849-b04e99bde692",
    backdrop: "3354f3c9-5337-479f-a849-b04e99bde692",
    detail_backdrop: "089c4e44-b2f6-4748-beb8-073e09de80ee"
  },

      // Lucky Luke (TMDB: 76120)
  202555: {
    poster: "0c0f5247-f032-48b2-8f5b-258c6e342724",
    backdrop: "0c0f5247-f032-48b2-8f5b-258c6e342724",
    detail_backdrop: "defb2ad8-4014-4609-b1a4-59341f999ef5"
  }
};

export function getCDNImageUrl(tmdbId: number, type: "poster" | "backdrop" | "detail_backdrop"): string | null {
  const mapping = cdnImageMapping[tmdbId];
  if (!mapping) return null;
  
  const imageId = mapping[type];
  if (!imageId) return null;
  
  return CDN_BASE_URL + imageId + ".webp";
}

export function hasCDNMapping(tmdbId: number): boolean {
  return tmdbId in cdnImageMapping;
}

export function getImageUrl(
  tmdbId: number,
  type: "poster" | "backdrop" | "detail_backdrop",
  fallbackPath: string | null,
  fallbackBaseUrl: string = "https://image.tmdb.org/t/p/",
  fallbackSize: string = "w500"
): string {
  const cdnUrl = getCDNImageUrl(tmdbId, type);
  if (cdnUrl) {
    return cdnUrl;
  }
  
  if (fallbackPath) {
    return fallbackBaseUrl + fallbackSize + fallbackPath;
  }
  
  return "/placeholder.jpg";
}
