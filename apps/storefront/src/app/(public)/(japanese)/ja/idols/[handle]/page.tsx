import {
  createArtistStorefrontPage,
  createArtistStorefrontMetadata,
} from "../../../../../../storefront/artist-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createArtistStorefrontMetadata("ja");
export default createArtistStorefrontPage("ja");
