-- Registers now use three marks only: Present, Absent, Late.
-- Old "Half day" marks become Present; old "Leave" marks become Absent with a note.
update "student_attendance" set "status" = 'present' where "status" = 'half_day';
--> statement-breakpoint
update "student_attendance"
   set "status" = 'absent',
       "remark" = case when "remark" = '' then 'On leave' else left('On leave: ' || "remark", 200) end
 where "status" = 'leave';
