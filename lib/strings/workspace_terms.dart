/// User-facing labels for client engagements.
/// APIs and database still use `deal`, `deal_id`, and `client_deals`.
abstract final class WorkspaceTerms {
  static const String project = 'Project';
  static const String projects = 'Projects';
  static const String jobsAndProjects = 'Jobs / Projects';

  static const String linkedProject = 'Linked project';
  static const String notLinkedProject = '— Not linked to a project —';
  static const String untitledProject = 'Untitled project';

  static String projectHashId(Object id) => 'Project #$id';

  /// e.g. "3 projects"
  static String projectCount(int n) => '$n ${n == 1 ? 'project' : 'projects'}';

  static const String projectPipelineBoard = 'Project pipeline board';
  static const String projectsAndOffers = 'Projects / Offers';
  static const String projectStatus = 'Project status';

  static const String linkedProjectValue = 'Linked project value';
  static const String projectValue = 'Project value';
  static const String projectsTotalValue = 'Projects value';
  static const String linkToProject = 'Link to project';
  static const String newProject = 'New project';
  static const String addProject = 'Add project';

  static const String loadingJobsAndProjects = 'Loading jobs and projects...';

  static const String noProjectsFound = 'No projects found';
  static const String clientPipelineSubtitle =
      'Add your first project to start tracking client pipeline.';

  /// Chip / table: human-readable [linked_type] value from storage.
  static String linkedTypeDisplay(String wireType) {
    switch (wireType) {
      case 'deal':
        return project;
      case 'job':
        return 'Job';
      case 'client':
        return 'Client';
      case 'payment':
        return 'Payment';
      case 'meeting':
        return 'Meeting';
      default:
        return wireType;
    }
  }
}
