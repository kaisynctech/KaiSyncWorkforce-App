import 'package:flutter/foundation.dart';

import '../models/job.dart';
import '../models/job_card.dart';
import '../services/supabase_timesheet_storage.dart';

class JobProvider with ChangeNotifier {
  List<Job> _myJobs = [];
  bool _isLoading = false;
  String? _error;
  String? _companyId;
  String? _employeeId;

  List<Job> get myJobs => List.unmodifiable(_myJobs);
  bool get isLoading => _isLoading;
  String? get error => _error;

  void setCompanyId(String? companyId) {
    _companyId = companyId;
  }

  void setEmployeeId(String? employeeId) {
    _employeeId = employeeId;
  }

  Future<void> loadMyJobs(String employeeId) async {
    _setLoading(true);
    try {
      _employeeId = employeeId;
      _myJobs = await SupabaseTimesheetStorage.getJobsForEmployee(
        employeeId,
        companyId: _companyId,
      );
      _error = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      _setLoading(false);
    }
  }

  Future<JobCard?> loadJobCard(String jobId) async {
    try {
      return await SupabaseTimesheetStorage.getJobCardForJob(
        jobId,
        companyId: _companyId,
        employeeId: _employeeId,
      );
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<void> saveJobCard(JobCard card) async {
    _setLoading(true);
    try {
      await SupabaseTimesheetStorage.upsertJobCard(
        card,
        companyId: _companyId,
        employeeId: _employeeId,
      );
      _error = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      _setLoading(false);
    }
  }

  Future<void> updateJob(Job job) async {
    _setLoading(true);
    try {
      await SupabaseTimesheetStorage.upsertJob(
        job,
        companyId: _companyId,
        employeeId: _employeeId,
      );
      _myJobs = _myJobs.map((j) => j.id == job.id ? job : j).toList();
      _error = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      _setLoading(false);
    }
  }

  void _setLoading(bool v) {
    _isLoading = v;
    notifyListeners();
  }
}

