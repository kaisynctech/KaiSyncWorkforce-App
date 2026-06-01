namespace KaiFlow.Timesheets.ViewModels;

public record InventoryUsageLine(string ItemName, string Supplier, double Quantity, double UnitCost, double TotalCost);
