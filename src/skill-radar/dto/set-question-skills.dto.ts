import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";

export class QuestionSkillMappingDto {
  @IsString()
  skillId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(5)
  weight?: number;
}

export class SetQuestionSkillsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionSkillMappingDto)
  mappings!: QuestionSkillMappingDto[];
}
