using Microsoft.Maui.Graphics;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Generic, module-agnostic chart value. Drives every KaiFlow chart drawable so
/// reporting/dashboards can render without coupling to a specific domain model.
/// </summary>
public sealed class ChartValue
{
    public ChartValue() { }

    public ChartValue(string label, double value, string? colorHex = null)
    {
        Label = label;
        Value = value;
        ColorHex = colorHex;
    }

    public string Label { get; set; } = string.Empty;
    public double Value { get; set; }
    public string? ColorHex { get; set; }
}

/// <summary>One segment within a stacked bar.</summary>
public sealed class ChartSegment
{
    public string Label { get; set; } = string.Empty;
    public double Value { get; set; }
    public string ColorHex { get; set; } = "#3B82F6";
}

/// <summary>A category column made of stacked segments.</summary>
public sealed class ChartStack
{
    public string Label { get; set; } = string.Empty;
    public IReadOnlyList<ChartSegment> Segments { get; set; } = [];
    public double Total => Segments.Sum(s => s.Value);
}

/// <summary>
/// Line / area chart. Set <see cref="FillArea"/> for a soft gradient fill under
/// the line. Dependency-free, dark/light friendly (colours are explicit).
/// </summary>
public sealed class LineSeriesDrawable : IDrawable
{
    public IReadOnlyList<ChartValue> Points { get; set; } = [];
    public Color LineColor { get; set; } = Color.FromArgb("#3B82F6");
    public Color AxisColor { get; set; } = Color.FromArgb("#94A3B8");
    public bool FillArea { get; set; } = true;
    public bool ShowDots { get; set; } = true;
    public float LineWidth { get; set; } = 2.5f;

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Points.Count == 0) return;

        const float labelH = 18f;
        const float topPad = 10f;
        const float sidePad = 6f;
        var chartH = rect.Height - labelH - topPad;
        var chartW = rect.Width - sidePad * 2f;
        if (chartH <= 0 || chartW <= 0) return;

        var max = Points.Max(p => p.Value);
        var min = Math.Min(0d, Points.Min(p => p.Value));
        var range = max - min;
        if (range <= 0) range = 1;

        float X(int i) => Points.Count == 1
            ? sidePad + chartW / 2f
            : sidePad + (float)i / (Points.Count - 1) * chartW;
        float Y(double v) => topPad + (float)(1 - (v - min) / range) * chartH;

        // Area fill
        if (FillArea && Points.Count > 1)
        {
            var area = new PathF();
            area.MoveTo(X(0), topPad + chartH);
            for (var i = 0; i < Points.Count; i++)
                area.LineTo(X(i), Y(Points[i].Value));
            area.LineTo(X(Points.Count - 1), topPad + chartH);
            area.Close();
            canvas.FillColor = LineColor.WithAlpha(0.14f);
            canvas.FillPath(area);
        }

        // Line
        if (Points.Count > 1)
        {
            var line = new PathF();
            line.MoveTo(X(0), Y(Points[0].Value));
            for (var i = 1; i < Points.Count; i++)
                line.LineTo(X(i), Y(Points[i].Value));
            canvas.StrokeColor = LineColor;
            canvas.StrokeSize = LineWidth;
            canvas.StrokeLineJoin = LineJoin.Round;
            canvas.DrawPath(line);
        }

        // Dots + labels
        canvas.FontSize = 10;
        for (var i = 0; i < Points.Count; i++)
        {
            if (ShowDots)
            {
                canvas.FillColor = LineColor;
                canvas.FillCircle(X(i), Y(Points[i].Value), 3f);
            }

            canvas.FontColor = AxisColor;
            var slot = chartW / Math.Max(1, Points.Count);
            canvas.DrawString(Points[i].Label, X(i) - slot / 2f, rect.Height - labelH, slot, labelH,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
    }
}

/// <summary>
/// Donut / pie chart rendered as a thick stroked ring (segment per slice).
/// Set <see cref="HoleRatio"/> to 0 for a solid pie. Optional centre caption.
/// </summary>
public sealed class DonutChartDrawable : IDrawable
{
    public IReadOnlyList<ChartValue> Slices { get; set; } = [];
    public float HoleRatio { get; set; } = 0.62f;
    public string? CenterText { get; set; }
    public string? CenterSubText { get; set; }
    public Color CenterTextColor { get; set; } = Color.FromArgb("#111827");
    public Color CenterSubColor { get; set; } = Color.FromArgb("#6B7280");

    private static readonly string[] Palette =
        ["#3B82F6", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B"];

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Slices.Count == 0) return;

        var total = Slices.Sum(s => s.Value);
        if (total <= 0) return;

        var size = Math.Min(rect.Width, rect.Height) - 8f;
        if (size <= 0) return;

        var cx = rect.Center.X;
        var cy = rect.Center.Y;
        var radius = size / 2f;
        var thickness = radius * (1f - HoleRatio);
        var ringRadius = radius - thickness / 2f;

        var ringRect = new RectF(cx - ringRadius, cy - ringRadius, ringRadius * 2f, ringRadius * 2f);

        canvas.StrokeSize = thickness;
        canvas.StrokeLineCap = LineCap.Butt;

        var start = 90f; // start at top
        for (var i = 0; i < Slices.Count; i++)
        {
            var sweep = (float)(Slices[i].Value / total) * 360f;
            var end = start - sweep; // clockwise
            var hex = Slices[i].ColorHex ?? Palette[i % Palette.Length];
            canvas.StrokeColor = Color.FromArgb(hex);
            canvas.DrawArc(ringRect.X, ringRect.Y, ringRect.Width, ringRect.Height,
                start, end, true, false);
            start = end;
        }

        if (!string.IsNullOrEmpty(CenterText))
        {
            canvas.FontColor = CenterTextColor;
            canvas.FontSize = 18;
            canvas.DrawString(CenterText, cx - radius, cy - 14f, radius * 2f, 20f,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
        if (!string.IsNullOrEmpty(CenterSubText))
        {
            canvas.FontColor = CenterSubColor;
            canvas.FontSize = 10;
            canvas.DrawString(CenterSubText, cx - radius, cy + 6f, radius * 2f, 14f,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
    }
}

/// <summary>Tiny inline trend line for KPI tiles (no axes, no labels).</summary>
public sealed class SparklineDrawable : IDrawable
{
    public IReadOnlyList<double> Values { get; set; } = [];
    public Color LineColor { get; set; } = Color.FromArgb("#3B82F6");
    public bool FillArea { get; set; } = true;

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Values.Count < 2) return;

        var max = Values.Max();
        var min = Values.Min();
        var range = max - min;
        if (range <= 0) range = 1;

        const float pad = 2f;
        var w = rect.Width - pad * 2f;
        var h = rect.Height - pad * 2f;

        float X(int i) => pad + (float)i / (Values.Count - 1) * w;
        float Y(double v) => pad + (float)(1 - (v - min) / range) * h;

        if (FillArea)
        {
            var area = new PathF();
            area.MoveTo(X(0), pad + h);
            for (var i = 0; i < Values.Count; i++)
                area.LineTo(X(i), Y(Values[i]));
            area.LineTo(X(Values.Count - 1), pad + h);
            area.Close();
            canvas.FillColor = LineColor.WithAlpha(0.16f);
            canvas.FillPath(area);
        }

        var line = new PathF();
        line.MoveTo(X(0), Y(Values[0]));
        for (var i = 1; i < Values.Count; i++)
            line.LineTo(X(i), Y(Values[i]));
        canvas.StrokeColor = LineColor;
        canvas.StrokeSize = 2f;
        canvas.StrokeLineJoin = LineJoin.Round;
        canvas.DrawPath(line);
    }
}

/// <summary>Vertical stacked bar chart (e.g. payroll components, cost breakdown by month).</summary>
public sealed class StackedBarDrawable : IDrawable
{
    public IReadOnlyList<ChartStack> Stacks { get; set; } = [];
    public Color AxisColor { get; set; } = Color.FromArgb("#94A3B8");

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Stacks.Count == 0) return;

        const float labelH = 18f;
        const float topPad = 8f;
        var chartH = rect.Height - labelH - topPad;
        var chartW = rect.Width;
        if (chartH <= 0 || chartW <= 0) return;

        var max = Stacks.Max(s => s.Total);
        if (max <= 0) max = 1;

        var slot = chartW / Stacks.Count;
        var bw = slot * 0.5f;
        canvas.FontSize = 10;

        for (var i = 0; i < Stacks.Count; i++)
        {
            var stack = Stacks[i];
            var slotX = i * slot;
            var x = slotX + (slot - bw) / 2f;
            var cursorY = topPad + chartH;

            foreach (var seg in stack.Segments)
            {
                var segH = (float)(seg.Value / max) * chartH;
                if (segH <= 0) continue;
                cursorY -= segH;
                canvas.FillColor = Color.FromArgb(seg.ColorHex);
                canvas.FillRectangle(x, cursorY, bw, segH);
            }

            canvas.FontColor = AxisColor;
            canvas.DrawString(stack.Label, slotX, rect.Height - labelH, slot, labelH,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
    }
}

/// <summary>Grid heatmap — rows × columns of intensity values (0–1 normalized internally).</summary>
public sealed class HeatmapDrawable : IDrawable
{
    public IReadOnlyList<string> RowLabels { get; set; } = [];
    public IReadOnlyList<string> ColumnLabels { get; set; } = [];
    public IReadOnlyList<IReadOnlyList<double>> Values { get; set; } = [];
    public Color LowColor { get; set; } = Color.FromArgb("#EEF2F7");
    public Color HighColor { get; set; } = Color.FromArgb("#3B82F6");

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Values.Count == 0 || ColumnLabels.Count == 0) return;

        const float labelW = 52f;
        const float labelH = 16f;
        var gridW = rect.Width - labelW;
        var gridH = rect.Height - labelH;
        if (gridW <= 0 || gridH <= 0) return;

        var max = Values.SelectMany(r => r).DefaultIfEmpty(0).Max();
        if (max <= 0) max = 1;

        var cellW = gridW / ColumnLabels.Count;
        var cellH = gridH / Values.Count;
        canvas.FontSize = 9;

        for (var r = 0; r < Values.Count; r++)
        {
            var row = Values[r];
            canvas.FontColor = Color.FromArgb("#64748B");
            var rowLabel = r < RowLabels.Count ? RowLabels[r] : "";
            canvas.DrawString(rowLabel, 0, labelH + r * cellH, labelW - 4, cellH,
                HorizontalAlignment.Right, VerticalAlignment.Center);

            for (var c = 0; c < ColumnLabels.Count && c < row.Count; c++)
            {
                var t = (float)(row[c] / max);
                canvas.FillColor = HighColor.WithAlpha(0.12f + t * 0.88f);
                canvas.FillRoundedRectangle(labelW + c * cellW + 1, labelH + r * cellH + 1,
                    cellW - 2, cellH - 2, 3);
            }
        }

        canvas.FontColor = Color.FromArgb("#94A3B8");
        for (var c = 0; c < ColumnLabels.Count; c++)
        {
            canvas.DrawString(ColumnLabels[c], labelW + c * cellW, 0, cellW, labelH,
                HorizontalAlignment.Center, VerticalAlignment.Center);
        }
    }
}

/// <summary>Horizontal timeline — events plotted on a date axis.</summary>
public sealed class TimelineDrawable : IDrawable
{
    public IReadOnlyList<ChartValue> Events { get; set; } = [];
    public Color LineColor { get; set; } = Color.FromArgb("#3B82F6");
    public Color DotColor { get; set; } = Color.FromArgb("#22C55E");
    public Color AxisColor { get; set; } = Color.FromArgb("#94A3B8");

    public void Draw(ICanvas canvas, RectF rect)
    {
        if (Events.Count == 0) return;

        const float labelH = 18f;
        const float pad = 8f;
        var trackY = rect.Height / 2f;
        var trackW = rect.Width - pad * 2f;
        canvas.StrokeColor = LineColor.WithAlpha(0.35f);
        canvas.StrokeSize = 2f;
        canvas.DrawLine(pad, trackY, pad + trackW, trackY);

        var max = Events.Max(e => e.Value);
        var min = Events.Min(e => e.Value);
        var range = max - min;
        if (range <= 0) range = 1;

        canvas.FontSize = 9;
        for (var i = 0; i < Events.Count; i++)
        {
            var x = Events.Count == 1 ? pad + trackW / 2f : pad + (float)i / (Events.Count - 1) * trackW;
            var dotR = 4f + (float)((Events[i].Value - min) / range) * 4f;
            canvas.FillColor = DotColor;
            canvas.FillCircle(x, trackY, dotR);
            canvas.FontColor = AxisColor;
            var slot = trackW / Math.Max(1, Events.Count);
            canvas.DrawString(Events[i].Label, x - slot / 2f, trackY + 10f, slot, labelH,
                HorizontalAlignment.Center, VerticalAlignment.Top);
        }
    }
}
