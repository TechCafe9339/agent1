export const instant = false;

import ProjectWorkspaceClient from "./ProjectWorkspaceClient";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;

  return (
    <ProjectWorkspaceClient
      projectId={id}
    />
  );
}