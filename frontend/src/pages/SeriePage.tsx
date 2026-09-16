// @ts-nocheck
import CatalogPage from "src/components/CatalogPage";
import { TV_TITLES } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";

export function Component() {
  return <CatalogPage mediaType={MEDIA_TYPE.Tv} title="Serie TV" categories={TV_TITLES} />;
}

Component.displayName = "SeriePage";
