// @ts-nocheck
import CatalogPage from "src/components/CatalogPage";
import { COMMON_TITLES } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";

export function Component() {
  return <CatalogPage mediaType={MEDIA_TYPE.Movie} title="Film" categories={COMMON_TITLES} />;
}

Component.displayName = "FilmPage";
