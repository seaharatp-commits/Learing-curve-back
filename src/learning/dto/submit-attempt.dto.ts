import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Min, ValidateNested } from "class-validator";

export class SubmitAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsInt()
  @Min(0)
  selectedIndex!: number;
}

export class SubmitAttemptDto {
  @IsArray()
  @ArrayMinSize(1, { message: "กรุณาตอบอย่างน้อย 1 ข้อก่อนส่งแบบทดสอบ" })
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}
