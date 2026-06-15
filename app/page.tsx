import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <HomeClient initialLibraryDocuments={[]} initialTitleOverrides={{}} />;
}
