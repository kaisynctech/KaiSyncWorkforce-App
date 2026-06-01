namespace KaiFlow.Timesheets.Helpers;

/// <summary>Decides insert vs update for job checklist rows.</summary>
public static class ChecklistPersistence
{
    public static bool ShouldInsert(bool existsInDatabase) => !existsInDatabase;
}
