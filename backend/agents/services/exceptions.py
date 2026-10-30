class RequirementAnalysisError(Exception):
    pass


class InvalidRequirementJSONError(
    RequirementAnalysisError
):
    pass


class InvalidApplicationSpecificationError(
    RequirementAnalysisError
):
    pass


class InvalidGeneratedStackError(
    RequirementAnalysisError
):
    pass