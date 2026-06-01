namespace KaiFlow.Timesheets.Services;

public static class ContractorPortalSessionStore
{
    private const string ContractorIdKey = "contractor_portal_contractor_id";
    private const string CompanyIdKey = "contractor_portal_company_id";
    private const string ContractorNameKey = "contractor_portal_contractor_name";
    private const string CompanyCodeKey = "contractor_portal_company_code";
    private const string ContractorCodeKey = "contractor_portal_contractor_code";

    public static void Save(Guid contractorId, Guid companyId, string contractorName, string companyCode, string contractorCode)
    {
        Preferences.Set(ContractorIdKey, contractorId.ToString());
        Preferences.Set(CompanyIdKey, companyId.ToString());
        Preferences.Set(ContractorNameKey, contractorName);
        Preferences.Set(CompanyCodeKey, companyCode);
        Preferences.Set(ContractorCodeKey, contractorCode);
    }

    public static void Clear()
    {
        Preferences.Remove(ContractorIdKey);
        Preferences.Remove(CompanyIdKey);
        Preferences.Remove(ContractorNameKey);
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(ContractorCodeKey);
    }

    public static bool HasSession =>
        Guid.TryParse(Preferences.Get(ContractorIdKey, ""), out _) &&
        Guid.TryParse(Preferences.Get(CompanyIdKey, ""), out _);

    public static (Guid ContractorId, Guid CompanyId, string ContractorName, string CompanyCode, string ContractorCode)? Get()
    {
        if (!Guid.TryParse(Preferences.Get(ContractorIdKey, ""), out var contractorId)) return null;
        if (!Guid.TryParse(Preferences.Get(CompanyIdKey, ""), out var companyId)) return null;
        return (
            contractorId,
            companyId,
            Preferences.Get(ContractorNameKey, ""),
            Preferences.Get(CompanyCodeKey, ""),
            Preferences.Get(ContractorCodeKey, ""));
    }
}
