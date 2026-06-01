using Microsoft.Maui.Graphics;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Lightweight, dependency-free chart drawables for the Finance dashboard,
/// rendered with MAUI's native GraphicsView. Robust FillRectangle/DrawString
/// rendering (no third-party charting library, no licensing).
/// </summary>
public sealed class BarSeriesDrawable : IDrawable
{
    public IReadOnlyList<FinanceTrendPoint> Points { get; set; } = [];
    public Color PrimaryColor { get; set; } = Color.FromArgb("#3B82F6");
    public Color SecondaryColor { get; set; } = Color.FromArgb("#F59E0B");
    public bool Grouped { get; set; }
    public Color AxisColor { get; set; } = Color.FromArgb("#94A3B8");

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Points.Count == 0) return;

        const float labelH = 18f;
        const float topPad = 8f;
        var chartH = rect.Height - labelH - topPad;
        var chartW = rect.Width;
        if (chartH <= 0 || chartW <= 0) return;

        var max = (double)Math.Max(
            Points.Max(p => p.Value),
            Grouped ? Points.Max(p => p.SecondaryValue) : 0m);
        if (max <= 0) max = 1;

        var slot = chartW / Points.Count;
        canvas.FontSize = 10;

        for (var i = 0; i < Points.Count; i++)
        {
            var p = Points[i];
            var slotX = i * slot;

            if (Grouped)
            {
                var bw = slot * 0.30f;
                var gap = slot * 0.08f;
                var h1 = (float)((double)p.Value / max) * chartH;
                var h2 = (float)((double)p.SecondaryValue / max) * chartH;
                var x1 = slotX + slot / 2f - bw - gap / 2f;
                var x2 = slotX + slot / 2f + gap / 2f;
                canvas.FillColor = PrimaryColor;
                canvas.FillRoundedRectangle(x1, topPad + (chartH - h1), bw, h1, 3);
                canvas.FillColor = SecondaryColor;
                canvas.FillRoundedRectangle(x2, topPad + (chartH - h2), bw, h2, 3);
            }
            else
            {
                var bw = slot * 0.5f;
                var h1 = (float)((double)p.Value / max) * chartH;
                var x1 = slotX + (slot - bw) / 2f;
                canvas.FillColor = PrimaryColor;
                canvas.FillRoundedRectangle(x1, topPad + (chartH - h1), bw, h1, 3);
            }

            canvas.FontColor = AxisColor;
            canvas.DrawString(p.Label, slotX, rect.Height - labelH, slot, labelH,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
    }
}

/// <summary>Horizontal proportion bars for a categorical breakdown (expenses, debtors).</summary>
public sealed class CategoryBarsDrawable : IDrawable
{
    public IReadOnlyList<FinanceCategorySlice> Slices { get; set; } = [];
    public Color LabelColor { get; set; } = Color.FromArgb("#475569");
    public Color TrackColor { get; set; } = Color.FromArgb("#EEF2F7");

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Slices.Count == 0) return;

        var max = (double)Slices.Max(s => s.Value);
        if (max <= 0) max = 1;

        var rowH = Math.Min(34f, rect.Height / Slices.Count);
        const float labelW = 0.42f; // fraction for label column
        var labelColW = rect.Width * labelW;
        var barColW = rect.Width - labelColW - 4f;
        canvas.FontSize = 11;

        for (var i = 0; i < Slices.Count; i++)
        {
            var s = Slices[i];
            var y = i * rowH;
            var barY = y + rowH * 0.28f;
            var barH = rowH * 0.44f;

            canvas.FontColor = LabelColor;
            canvas.DrawString(s.Label, 0, y, labelColW, rowH,
                HorizontalAlignment.Left, VerticalAlignment.Center);

            canvas.FillColor = TrackColor;
            canvas.FillRoundedRectangle(labelColW, barY, barColW, barH, 4);

            var w = (float)((double)s.Value / max) * barColW;
            canvas.FillColor = Color.FromArgb(s.Color);
            canvas.FillRoundedRectangle(labelColW, barY, Math.Max(2f, w), barH, 4);
        }
    }
}
