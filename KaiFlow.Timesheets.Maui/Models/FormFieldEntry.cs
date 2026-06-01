using CommunityToolkit.Mvvm.ComponentModel;

namespace KaiFlow.Timesheets.Models;

public partial class FormFieldEntry : ObservableObject
{
    public FormField Field { get; }

    [ObservableProperty] private string _value = "";
    [ObservableProperty] private bool _boolValue;
    [ObservableProperty] private DateTime _dateValue = DateTime.Today;

    public bool IsTextType => Field.FieldType is "text" or "number" or "signature";
    public bool IsCheckType => Field.FieldType == "checkbox";
    public bool IsDateType => Field.FieldType == "date";
    public bool IsSelectType => Field.FieldType == "select";

    public FormFieldEntry(FormField field) => Field = field;

    public object GetValue() => Field.FieldType switch
    {
        "checkbox" => BoolValue,
        "date" => DateValue.ToString("yyyy-MM-dd"),
        _ => Value
    };
}
