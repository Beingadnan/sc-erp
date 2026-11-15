import { Module } from '@nestjs/common';
import type { DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import {
  AcademicYearsController,
  CalendarController,
  GradingController,
  StructureController,
} from './academic/academic.controllers.js';
import { AcademicYearsService } from './academic/academic-years.service.js';
import { CalendarService } from './academic/calendar.service.js';
import { GradingService } from './academic/grading.service.js';
import { AcademicSetupService } from './academic/setup.service.js';
import { StructureService } from './academic/structure.service.js';
import { AccessGuard } from './auth/access.guard.js';
import { FILE_STORAGE, storageFor } from './storage/file-storage.js';
import { CustomFieldsService } from './records/custom-fields.service.js';
import { ImportExportService } from './records/import-export.service.js';
import { LifecycleService } from './records/lifecycle.service.js';
import {
  CustomFieldsController,
  ImportExportController,
  LifecycleController,
} from './records/records.controllers.js';
import { ApplicationsService } from './admissions/applications.service.js';
import { DocumentsService } from './admissions/documents.service.js';
import {
  ApplicationsController,
  DocumentsController,
  LocalFilesController,
} from './admissions/admissions.controllers.js';
import { AdmissionNumbersService } from './students/admission-numbers.service.js';
import { PiiVault } from './students/pii-vault.js';
import { StudentsService } from './students/students.service.js';
import {
  AdmissionNumbersController,
  GuardiansController,
  StudentsController,
} from './students/students.controllers.js';
import { CmsService } from './website/cms.service.js';
import { InquiriesService } from './website/inquiries.service.js';
import { PublicSiteService } from './website/public-site.service.js';
import {
  CmsController,
  InquiriesController,
  PublicSiteController,
} from './website/website.controllers.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { CaptureMailer, ConsoleMailer, MAILER, UnconfiguredMailer } from './auth/mailer.js';
import { PasswordService } from './auth/password.service.js';
import { SessionService } from './auth/session.service.js';
import { AllExceptionsFilter } from './common/http-exception.filter.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { API_CONFIG } from './config/api-config.js';
import type { ApiConfig } from './config/api-config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { Public } from './auth/decorators.js';
import { PlatformController } from './platform/platform.controller.js';
import { AuditQueryService } from './tenancy/audit-query.service.js';
import { AuditService } from './tenancy/audit.service.js';
import { CampusesService } from './tenancy/campuses.service.js';
import { MembersService } from './tenancy/members.service.js';
import { OutboxService } from './tenancy/outbox.service.js';
import { AttendanceController } from './attendance/attendance.controller.js';
import { AttendanceService } from './attendance/attendance.service.js';
import { DemandsController, FeeSetupController } from './fees/fees.controllers.js';
import { FeeSetupService } from './fees/fee-setup.service.js';
import { DemandsService } from './fees/demands.service.js';
import { PaymentsController } from './fees/payments.controller.js';
import { PaymentsService } from './fees/payments.service.js';
import { FeeReportsService } from './fees/fee-reports.service.js';
import { PayToSchoolController, PublicPayController } from './fees/pay-to-school.controllers.js';
import { PayToSchoolService } from './fees/pay-to-school.service.js';
import { RefundsService } from './fees/refunds.service.js';
import {
  FamilyController,
  PortalAccessController,
  PortalActivateController,
} from './portal/portal.controllers.js';
import { PortalService } from './portal/portal.service.js';
import { TeachingController } from './academic/teaching.controller.js';
import { TeachingService } from './academic/teaching.service.js';
import { SetupImportController } from './setup/setup-import.controller.js';
import { SetupImportService } from './setup/setup-import.service.js';
import { OpeningBalancesController } from './setup/opening.controller.js';
import { OpeningBalancesService } from './setup/opening.service.js';
import { ClassroomController, NoticesController } from './classroom/classroom.controllers.js';
import { ClassroomService } from './classroom/classroom.service.js';
import { ExamsController } from './exams/exams.controller.js';
import { ExamsService } from './exams/exams.service.js';
import { NoticesService } from './classroom/notices.service.js';
import { RolesService } from './tenancy/roles.service.js';
import {
  AuditController,
  CampusesController,
  MembersController,
  RolesController,
  TenantController,
} from './tenancy/tenancy.controllers.js';
import { TenantService } from './tenancy/tenant.service.js';

// Health probes need no session.
Public()(HealthController);

const mailerFor = (config: ApiConfig) =>
  config.NODE_ENV === 'test'
    ? new CaptureMailer()
    : config.NODE_ENV === 'development'
      ? new ConsoleMailer()
      : new UnconfiguredMailer();

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule],
      controllers: [
        HealthController,
        AuthController,
        TenantController,
        CampusesController,
        RolesController,
        MembersController,
        AuditController,
        AcademicYearsController,
        StructureController,
        GradingController,
        CalendarController,
        CmsController,
        InquiriesController,
        PublicSiteController,
        // Before StudentsController: /students/export must not match /students/:id.
        ImportExportController,
        LifecycleController,
        AttendanceController,
        FeeSetupController,
        DemandsController,
        PaymentsController,
        PayToSchoolController,
        PublicPayController,
        PortalAccessController,
        PortalActivateController,
        FamilyController,
        TeachingController,
        SetupImportController,
        OpeningBalancesController,
        ClassroomController,
        ExamsController,
        NoticesController,
        CustomFieldsController,
        StudentsController,
        GuardiansController,
        AdmissionNumbersController,
        ApplicationsController,
        DocumentsController,
        LocalFilesController,
        PlatformController,
      ],
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: MAILER, useValue: mailerFor(config) },
        { provide: FILE_STORAGE, useValue: storageFor(config) },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: AccessGuard },
        PasswordService,
        SessionService,
        AuthService,
        AuditService,
        OutboxService,
        TenantService,
        CampusesService,
        RolesService,
        MembersService,
        AuditQueryService,
        AcademicYearsService,
        StructureService,
        GradingService,
        CalendarService,
        AcademicSetupService,
        CmsService,
        InquiriesService,
        PublicSiteService,
        PiiVault,
        AdmissionNumbersService,
        StudentsService,
        ApplicationsService,
        DocumentsService,
        CustomFieldsService,
        LifecycleService,
        AttendanceService,
        FeeSetupService,
        DemandsService,
        PaymentsService,
        FeeReportsService,
        PayToSchoolService,
        RefundsService,
        PortalService,
        TeachingService,
        SetupImportService,
        OpeningBalancesService,
        ClassroomService,
        ExamsService,
        NoticesService,
        ImportExportService,
      ],
      exports: [API_CONFIG, MAILER, FILE_STORAGE],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
