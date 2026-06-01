using KaiFlow.Timesheets.Helpers;
using Xunit;

namespace KaiFlow.Timesheets.Tests;

public class ChecklistPersistenceTests
{
    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void ShouldInsert_reflects_database_presence(bool existsInDatabase, bool expectedInsert)
    {
        Assert.Equal(expectedInsert, ChecklistPersistence.ShouldInsert(existsInDatabase));
    }
}
