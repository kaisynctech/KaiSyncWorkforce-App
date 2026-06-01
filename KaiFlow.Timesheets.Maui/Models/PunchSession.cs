namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Aggregates a clock-in + clock-out pair into a payable session.
/// Computed client-side from pairs of TimePunch records.
/// </summary>
public class PunchSession
{
    public Guid EmployeeId { get; init; }
    public string EmployeeName { get; init; } = "";
    public string? EmployeeCode { get; init; }
    public DateTime ClockIn { get; init; }
    public DateTime? ClockOut { get; init; }
    public double DailyHours { get; init; } = 8.0;
    public double OvertimeRate { get; init; } = 1.5;
    public double HourlyRate { get; init; }
    public Guid? JobId { get; init; }
    public string? Notes { get; init; }

    /// <summary>Synthetic row for an HR-marked or self-reported absence (no punches).</summary>
    public bool IsAbsentDay { get; init; }
    /// <summary>Synthetic row for an approved leave day (no punches).</summary>
    public bool IsLeaveDay { get; init; }
    public string? StatusNote { get; init; }

    public bool IsNonWorkDay => IsAbsentDay || IsLeaveDay;

    // Shift template & company attendance rules (null = fall back to DailyHours)
    public EmployeeShiftTemplate? ShiftTemplate { get; init; }
    public int LateThresholdMinutes { get; init; } = 30;
    public int OtStartAfterMinutes { get; init; } = 30;

    // Clock-in location
    public double? ClockInLatitude { get; init; }
    public double? ClockInLongitude { get; init; }
    public string? ClockInAddress { get; init; }

    // Clock-out location
    public double? ClockOutLatitude { get; init; }
    public double? ClockOutLongitude { get; init; }
    public string? ClockOutAddress { get; init; }

    // ── Raw elapsed ─────────────────────────────────────────────────────────

    public TimeSpan Duration => ClockOut.HasValue
        ? ClockOut.Value - ClockIn
        : DateTime.UtcNow - ClockIn;

    public double TotalHours => Duration.TotalHours;

    // ── Late detection ──────────────────────────────────────────────────────

    public bool IsLate
    {
        get
        {
            if (IsNonWorkDay) return false;
            if (ShiftTemplate == null) return false;
            var localIn = TimeOnly.FromDateTime(ClockIn.ToLocalTime());
            var minsLate = (localIn - ShiftTemplate.StartTime).TotalMinutes;
            return minsLate > LateThresholdMinutes;
        }
    }

    public int LateMinutes
    {
        get
        {
            if (!IsLate || ShiftTemplate == null) return 0;
            var localIn = TimeOnly.FromDateTime(ClockIn.ToLocalTime());
            return (int)(localIn - ShiftTemplate.StartTime).TotalMinutes;
        }
    }

    public string LateFlag
    {
        get
        {
            if (!IsLate) return "";
            var h = LateMinutes / 60;
            var m = LateMinutes % 60;
            var parts = h > 0 ? (m > 0 ? $"{h}h {m}m" : $"{h}h") : $"{m}m";
            return $"Late {parts}";
        }
    }

    // ── Early departure ──────────────────────────────────────────────────────

    public bool IsLeftEarly
    {
        get
        {
            if (ShiftTemplate == null || !ClockOut.HasValue) return false;
            var localOut = ClockOut.Value.ToLocalTime();
            var shiftEnd = localOut.Date.Add(ShiftTemplate.EndTime.ToTimeSpan());
            if (shiftEnd < BillingStart) shiftEnd = shiftEnd.AddDays(1);
            return localOut < shiftEnd;
        }
    }

    public int EarlyMinutes
    {
        get
        {
            if (!IsLeftEarly || ShiftTemplate == null || !ClockOut.HasValue) return 0;
            var localOut = ClockOut.Value.ToLocalTime();
            var shiftEnd = localOut.Date.Add(ShiftTemplate.EndTime.ToTimeSpan());
            if (shiftEnd < BillingStart) shiftEnd = shiftEnd.AddDays(1);
            return (int)(shiftEnd - localOut).TotalMinutes;
        }
    }

    public string EarlyFlag
    {
        get
        {
            if (!IsLeftEarly) return "";
            var h = EarlyMinutes / 60;
            var m = EarlyMinutes % 60;
            var parts = h > 0 ? (m > 0 ? $"{h}h {m}m" : $"{h}h") : $"{m}m";
            return $"Left Early {parts}";
        }
    }

    // ── Template-aware billing ───────────────────────────────────────────────

    // Where billing starts: shift-start if on time/early, actual clock-in if late
    private DateTime BillingStart
    {
        get
        {
            if (ShiftTemplate == null) return ClockIn;
            var localIn = ClockIn.ToLocalTime();
            return IsLate
                ? localIn
                : localIn.Date.Add(ShiftTemplate.StartTime.ToTimeSpan());
        }
    }

    public double RegularHours
    {
        get
        {
            if (IsNonWorkDay) return 0;

            if (ShiftTemplate == null)
                return Math.Min(TotalHours, DailyHours);

            if (!ClockOut.HasValue)
                return Math.Max(0, (DateTime.Now - BillingStart).TotalHours
                    - ShiftTemplate.TotalBreakMinutes / 60.0);

            var localOut = ClockOut.Value.ToLocalTime();
            var paidElapsed = (localOut - BillingStart).TotalHours
                - ShiftTemplate.TotalBreakMinutes / 60.0;
            return Math.Max(0, Math.Min(paidElapsed, ShiftTemplate.PaidHours));
        }
    }

    public double OvertimeHours
    {
        get
        {
            if (IsNonWorkDay) return 0;

            if (ShiftTemplate == null)
                return Math.Max(0, TotalHours - DailyHours);

            if (!ClockOut.HasValue) return 0;

            var localOut = ClockOut.Value.ToLocalTime();
            var shiftEnd = localOut.Date.Add(ShiftTemplate.EndTime.ToTimeSpan());
            if (shiftEnd < BillingStart) shiftEnd = shiftEnd.AddDays(1);

            var minutesPastEnd = (localOut - shiftEnd).TotalMinutes;
            return minutesPastEnd > OtStartAfterMinutes
                ? (minutesPastEnd - OtStartAfterMinutes) / 60.0
                : 0;
        }
    }

    public double RegularPay  => RegularHours * HourlyRate;
    public double OvertimePay => OvertimeHours * HourlyRate * OvertimeRate;
    public double TotalPay    => RegularPay + OvertimePay;

    public bool IsOpen      => !ClockOut.HasValue;
    public bool HasLocation => ClockInLatitude.HasValue && ClockInLongitude.HasValue;
    public string? MapsUrl  => HasLocation ? $"https://maps.google.com/?q={ClockInLatitude},{ClockInLongitude}" : null;

    public DateOnly Date => DateOnly.FromDateTime(ClockIn.ToLocalTime());

    // Display helpers
    public string TimeInDisplay => IsAbsentDay ? "Absent" : IsLeaveDay ? "On Leave" : ClockIn.ToLocalTime().ToString("h:mm tt");
    public string TimeOutDisplay => IsNonWorkDay ? "—" : ClockOut.HasValue ? ClockOut.Value.ToLocalTime().ToString("h:mm tt") : "—";
    public string DateDisplay     => ClockIn.ToLocalTime().ToString("ddd d MMM yyyy");
    public string TotalHrsDisplay => IsNonWorkDay ? "0.0h" : $"{(RegularHours + OvertimeHours):F1}h";
    public string TimeInColorHex  => IsAbsentDay ? "#EF4444" : IsLeaveDay ? "#F59E0B" : IsLate ? "#EF4444" : "#22C55E";
    public string InLocationDisplay  => IsNonWorkDay ? "—" : ClockInAddress ?? (ClockInLatitude.HasValue  ? $"{ClockInLatitude:F4}, {ClockInLongitude:F4}"  : "—");
    public string OutLocationDisplay => IsNonWorkDay ? "—" : ClockOutAddress ?? (ClockOutLatitude.HasValue ? $"{ClockOutLatitude:F4}, {ClockOutLongitude:F4}" : "—");
    public string DisplayNotes => IsNonWorkDay ? (StatusNote ?? (IsAbsentDay ? "Absent" : "On leave")) : (Notes ?? "—");

    // ── Build sessions from punch records ────────────────────────────────────

    public static List<PunchSession> Build(
        IEnumerable<TimePunch> punches,
        Dictionary<Guid, Employee>? employeeMap = null,
        Dictionary<Guid, EmployeeShiftTemplate>? templateMap = null,
        int lateThresholdMinutes = 30,
        int otStartAfterMinutes = 30)
    {
        var sessions = new List<PunchSession>();
        var grouped = punches.GroupBy(p => p.EmployeeId);

        foreach (var group in grouped)
        {
            Employee? emp = null;
            employeeMap?.TryGetValue(group.Key, out emp);

            EmployeeShiftTemplate? template = null;
            if (templateMap != null && emp?.ShiftTemplateId.HasValue == true)
                templateMap.TryGetValue(emp.ShiftTemplateId!.Value, out template);

            var sorted = group.OrderBy(p => p.DateTime).ToList();
            TimePunch? clockIn = null;

            foreach (var punch in sorted)
            {
                if (punch.PunchType == PunchType.In)
                {
                    if (clockIn != null)
                        sessions.Add(MakeSession(clockIn, null, group.Key, emp, template, lateThresholdMinutes, otStartAfterMinutes));
                    clockIn = punch;
                }
                else if (clockIn != null)
                {
                    sessions.Add(MakeSession(clockIn, punch, group.Key, emp, template, lateThresholdMinutes, otStartAfterMinutes));
                    clockIn = null;
                }
                else
                {
                    sessions.Add(MakeSession(null, punch, group.Key, emp, template, lateThresholdMinutes, otStartAfterMinutes));
                }
            }

            if (clockIn != null)
                sessions.Add(MakeSession(clockIn, null, group.Key, emp, template, lateThresholdMinutes, otStartAfterMinutes));
        }

        return sessions.OrderByDescending(s => s.ClockIn).ToList();
    }

    private static PunchSession MakeSession(
        TimePunch? clockIn, TimePunch? clockOut,
        Guid employeeId, Employee? emp,
        EmployeeShiftTemplate? template,
        int lateThreshold, int otStartAfter)
    {
        var outPunch = clockOut;
        return new PunchSession
        {
            EmployeeId        = employeeId,
            EmployeeName      = emp?.FullName ?? employeeId.ToString(),
            EmployeeCode      = emp?.EmployeeCode,
            ClockIn           = (clockIn?.DateTime ?? outPunch!.DateTime).ToUniversalTime(),
            ClockOut          = outPunch?.DateTime.ToUniversalTime(),
            HourlyRate        = emp?.HourlyRate ?? 0,
            DailyHours        = emp?.DailyHours ?? 8.0,
            OvertimeRate      = emp?.OvertimeRate > 0 ? emp.OvertimeRate : 1.5,
            ShiftTemplate     = template,
            LateThresholdMinutes = lateThreshold,
            OtStartAfterMinutes  = otStartAfter,
            JobId             = clockIn?.JobId,
            Notes             = outPunch?.Notes ?? clockIn?.Notes,
            ClockInLatitude   = clockIn?.Latitude,
            ClockInLongitude  = clockIn?.Longitude,
            ClockInAddress    = clockIn?.Address,
            ClockOutLatitude  = outPunch?.Latitude,
            ClockOutLongitude = outPunch?.Longitude,
            ClockOutAddress   = outPunch?.Address,
        };
    }

    public static PunchSession ForAbsentDay(
        Employee emp,
        DateOnly date,
        DailyAbsence absence,
        EmployeeShiftTemplate? template = null,
        int lateThresholdMinutes = 30,
        int otStartAfterMinutes = 30)
    {
        var localMidnight = date.ToDateTime(TimeOnly.MinValue);
        var note = absence.ReasonLabel;
        if (!string.IsNullOrWhiteSpace(absence.Note))
            note += $" – {absence.Note}";

        return new PunchSession
        {
            EmployeeId           = emp.Id,
            EmployeeName         = emp.FullName,
            EmployeeCode         = emp.EmployeeCode,
            ClockIn              = localMidnight.ToUniversalTime(),
            ClockOut             = localMidnight.ToUniversalTime(),
            HourlyRate           = emp.HourlyRate,
            DailyHours           = emp.DailyHours,
            OvertimeRate         = emp.OvertimeRate > 0 ? emp.OvertimeRate : 1.5,
            ShiftTemplate        = template,
            LateThresholdMinutes = lateThresholdMinutes,
            OtStartAfterMinutes  = otStartAfterMinutes,
            IsAbsentDay          = true,
            StatusNote           = note,
            Notes                = note,
        };
    }

    public static PunchSession ForLeaveDay(
        Employee emp,
        DateOnly date,
        LeaveRequest leave,
        EmployeeShiftTemplate? template = null,
        int lateThresholdMinutes = 30,
        int otStartAfterMinutes = 30)
    {
        var localMidnight = date.ToDateTime(TimeOnly.MinValue);
        var note = leave.LeaveType;

        return new PunchSession
        {
            EmployeeId           = emp.Id,
            EmployeeName         = emp.FullName,
            EmployeeCode         = emp.EmployeeCode,
            ClockIn              = localMidnight.ToUniversalTime(),
            ClockOut             = localMidnight.ToUniversalTime(),
            HourlyRate           = emp.HourlyRate,
            DailyHours           = emp.DailyHours,
            OvertimeRate         = emp.OvertimeRate > 0 ? emp.OvertimeRate : 1.5,
            ShiftTemplate        = template,
            LateThresholdMinutes = lateThresholdMinutes,
            OtStartAfterMinutes  = otStartAfterMinutes,
            IsLeaveDay           = true,
            StatusNote           = note,
            Notes                = note,
        };
    }
}
