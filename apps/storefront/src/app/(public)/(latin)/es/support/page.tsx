import { createInformationPage } from "../../../../../storefront/information-page-factory";
export const dynamic = "force-dynamic";
const page = createInformationPage("es", "SUPPORT");
export const generateMetadata = page.generateMetadata;
export default page.Page;
