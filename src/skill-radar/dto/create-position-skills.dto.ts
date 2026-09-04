import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { PositionSkillDto } from "./position-skill.dto";

export class CreatePositionSkillsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => PositionSkillDto)
  skills!: PositionSkillDto[];
}
