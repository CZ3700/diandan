import {
  createArtistStorefrontPage,
  createArtistStorefrontMetadata,
} from "../../../../../../storefront/artist-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createArtistStorefrontMetadata("en");
export default createArtistStorefrontPage("en");
