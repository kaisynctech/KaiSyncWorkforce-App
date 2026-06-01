using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record MoveProjectRequest(ClientDeal Deal, string TargetStage);
